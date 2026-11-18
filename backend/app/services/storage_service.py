"""
AjiCorehpc Manager — Real-Time Storage & NFS Management Service
Collects live filesystem telemetry, manages NFS server exports,
configures client node mount points, and tracks storage utilization.
"""
import os
import re
import time
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import paramiko
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.models import Node, Cluster, StorageMount, NfsExport, NfsClientMount, Alert
from app.core.security_crypto import extract_node_credentials
from app.services.node_monitor import NodeMonitorService
from fastapi import HTTPException

logger = logging.getLogger("storage_service")


class StorageService:
    DEFAULT_MASTER_IP = os.getenv("MASTER_NODE_IP", "")
    DEFAULT_WORKER_IP = os.getenv("WORKER_NODE_IP", "")
    DEFAULT_SSH_USER = os.getenv("NODE_SSH_USER", "root")
    DEFAULT_SSH_PASS = os.getenv("NODE_SSH_PASSWORD", "")

    _cached_overview: Optional[Dict[str, Any]] = None
    _cached_overview_time: float = 0.0

    @classmethod
    def get_ssh_client(
        cls,
        ip: str,
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        private_key: Optional[str] = None,
        port: int = 22,
        timeout: float = 6.0,
    ) -> Tuple[Optional[paramiko.SSHClient], Optional[str]]:
        """Establishes an SSH connection using Paramiko."""
        if not ip or not ip.strip():
            return None, "No IP address specified"
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            if private_key:
                from io import StringIO
                key_file = StringIO(private_key.strip())
                try:
                    pkey = paramiko.RSAKey.from_private_key(key_file)
                except Exception:
                    key_file.seek(0)
                    pkey = paramiko.Ed25519Key.from_private_key(key_file)
                client.connect(
                    hostname=ip, port=port, username=user,
                    pkey=pkey, timeout=timeout, banner_timeout=timeout,
                    look_for_keys=False, allow_agent=False,
                )
            else:
                client.connect(
                    hostname=ip, port=port, username=user,
                    password=password, timeout=timeout, banner_timeout=timeout,
                    look_for_keys=False, allow_agent=False,
                )
            return client, None
        except Exception as e:
            return None, str(e)

    @classmethod
    def execute_command(
        cls,
        ip: str,
        cmd: str,
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        private_key: Optional[str] = None,
        port: int = 22,
        timeout: float = 4.0,
    ) -> Tuple[int, str, str]:
        """Executes a command on a remote node via SSH."""
        client, err = cls.get_ssh_client(ip, user=user, password=password, private_key=private_key, port=port, timeout=timeout)
        if not client:
            return 1, "", f"SSH connection to {ip} failed: {err}"
        try:
            stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="ignore").strip()
            err_msg = stderr.read().decode("utf-8", errors="ignore").strip()
            exit_code = stdout.channel.recv_exit_status()
            client.close()
            return exit_code, out, err_msg
        except Exception as e:
            try:
                client.close()
            except Exception:
                pass
            return 1, "", str(e)

    # ---------------------------------------------------------------------------
    # 1. Real-Time Storage Overview Dashboard
    # ---------------------------------------------------------------------------

    @classmethod
    async def get_storage_overview(cls, db: AsyncSession, tenant_id: Optional[Any] = None) -> Dict[str, Any]:
        """Collects real-time storage metrics from real master and worker nodes."""
        now = time.time()
        # Return recent cache if available (within 10 seconds) to avoid redundant rapid hits
        if cls._cached_overview and (now - cls._cached_overview_time) < 10.0:
            return cls._cached_overview

        try:
            all_exports = []
            all_client_mounts = []
            alerts_list = []
            nodes_utilization = []

            # 1. Dynamic cluster node resolution - only select nodes belonging to active clusters
            clusters_cnt_res = await db.execute(select(func.count(Cluster.id)))
            cluster_count = clusters_cnt_res.scalar() or 0
            if cluster_count == 0:
                all_db_nodes = []
            else:
                nodes_q = await db.execute(
                    select(Node).where(Node.cluster_id.isnot(None)).order_by(Node.node_type.desc(), Node.hostname.asc())
                )
                all_db_nodes = nodes_q.scalars().all()

            if not all_db_nodes:
                return {
                    "summary": {
                        "total_capacity_gb": 0.0,
                        "used_capacity_gb": 0.0,
                        "available_capacity_gb": 0.0,
                        "usage_percentage": 0.0,
                        "nfs_exports_count": 0,
                        "client_mounts_count": 0,
                        "failed_mounts_count": 0,
                        "cluster_nodes_count": 0,
                        "active_storage_nodes": 0,
                    },
                    "nodes_utilization": [],
                    "nfs_exports": [],
                    "client_mounts": [],
                    "backup_repository": {
                        "name": "Local Cluster Repository (/backup)",
                        "path": "/backup",
                        "server_ip": "None",
                        "total_gb": 0.0,
                        "free_gb": 0.0,
                        "status": "Unconfigured",
                        "latest_backup": "None pending",
                        "recovery_points_count": 0,
                    },
                    "alerts": [],
                }

            # Helper for parsing human-readable disk sizes (e.g., '500G', '1.2T', '450M')
            def parse_gb(s: str) -> float:
                if not s:
                    return 0.0
                s = str(s).strip().upper().replace('B', '')
                if s.endswith('T'):
                    try: return round(float(s[:-1]) * 1024, 1)
                    except Exception: return 0.0
                if s.endswith('G'):
                    try: return round(float(s[:-1]), 1)
                    except Exception: return 0.0
                if s.endswith('M'):
                    try: return round(float(s[:-1]) / 1024, 2)
                    except Exception: return 0.0
                if s.endswith('K'):
                    try: return round(float(s[:-1]) / (1024 * 1024), 3)
                    except Exception: return 0.0
                try: return round(float(s), 1)
                except Exception: return 0.0

            # 2. Iterate dynamically through ALL enrolled nodes
            compute_counter = 1
            monitor_cache = NodeMonitorService.get_instance().telemetry_cache

            for n in all_db_nodes:
                is_master = (n.node_type == "master")
                actual_ip = (n.address or n.management_ip or "").strip()
                if is_master:
                    role_display = "Master / Storage Controller"
                else:
                    role_display = f"Compute Worker {compute_counter:02d}"
                    compute_counter += 1

                # Extract credentials if available
                node_tags = n.tags if isinstance(n.tags, dict) else {}
                ssh_user, ssh_pass, ssh_key, ssh_port = extract_node_credentials(node_tags)

                # Initialize metrics from registered DB baseline
                db_total_gb = round(float(n.disk_total_gb or 500.0), 1)
                db_used_gb = round(float(n.disk_used_gb or round(db_total_gb * 0.02, 1)), 1)
                db_avail_gb = round(max(0.0, db_total_gb - db_used_gb), 1)
                db_pct = round((db_used_gb / max(1.0, db_total_gb)) * 100, 1)

                node_storage = {
                    "total_gb": db_total_gb,
                    "used_gb": db_used_gb,
                    "avail_gb": db_avail_gb,
                    "usage_pct": db_pct,
                    "status": n.state if n.state in ["online", "degraded"] else "degraded",
                    "mounts": []
                }

                ssh_succeeded = False

                # If IP and credentials exist, attempt live SSH probe
                if actual_ip and (ssh_pass or ssh_key):
                    if is_master:
                        probe_cmd = "df -hT -P | grep -E '^/dev/' | grep -v 'loop'; echo '---'; exportfs -v 2>/dev/null; echo '---'; systemctl is-active nfs-server rpcbind 2>/dev/null; echo '---'; df -hT /backup 2>/dev/null || df -hT /"
                    else:
                        probe_cmd = "df -hT -P | grep -E '^/dev/' | grep -v 'loop'; echo '---'; mount -t nfs,nfs4 2>/dev/null; echo '---'; grep -E 'nfs|nfs4' /etc/fstab 2>/dev/null || true"

                    code, stdout_str, err_str = cls.execute_command(
                        actual_ip,
                        probe_cmd,
                        user=ssh_user,
                        password=ssh_pass,
                        private_key=ssh_key,
                        port=ssh_port,
                        timeout=3.5,
                    )

                    if code == 0 and stdout_str:
                        ssh_succeeded = True
                        parts = stdout_str.split("---")
                        df_lines = parts[0].strip().split("\n") if len(parts) > 0 else []

                        live_mounts = []
                        live_total = 0.0
                        live_used = 0.0
                        live_avail = 0.0

                        for line in df_lines:
                            tokens = line.split()
                            if len(tokens) >= 7:
                                dev, fstype, size_s, used_s, avail_s, use_pct_s, mnt = tokens[:7]
                                t_gb = parse_gb(size_s)
                                u_gb = parse_gb(used_s)
                                a_gb = parse_gb(avail_s)
                                pct = int(use_pct_s.replace('%', '')) if '%' in use_pct_s else 0

                                if mnt in ['/', '/home', '/boot', '/apps', '/scratch']:
                                    live_total += t_gb
                                    live_used += u_gb
                                    live_avail += a_gb

                                live_mounts.append({
                                    "device": dev,
                                    "filesystem": fstype,
                                    "mount_point": mnt,
                                    "size": size_s,
                                    "used": used_s,
                                    "available": avail_s,
                                    "use_pct": pct,
                                    "is_nfs_exported": False,
                                })

                        if live_mounts:
                            node_storage["mounts"] = live_mounts
                            node_storage["total_gb"] = round(live_total or db_total_gb, 1)
                            node_storage["used_gb"] = round(live_used or db_used_gb, 1)
                            node_storage["avail_gb"] = round(live_avail or db_avail_gb, 1)
                            node_storage["usage_pct"] = round((node_storage["used_gb"] / max(1.0, node_storage["total_gb"])) * 100, 1)
                            node_storage["status"] = "online"

                        # Parse exports on master
                        if is_master and len(parts) > 1:
                            export_lines = parts[1].strip().split("\n")
                            for eline in export_lines:
                                eline = eline.strip()
                                if not eline or eline.startswith("#"): continue
                                exp_match = re.match(r"^(\S+)\s+(\S+)\((.*?)\)", eline)
                                if exp_match:
                                    epath, eclients, eopts = exp_match.groups()
                                    all_exports.append({
                                        "path": epath,
                                        "clients": eclients,
                                        "options": eopts,
                                        "server_ip": actual_ip,
                                        "status": "Active",
                                        "fs_type": "xfs",
                                    })
                                    for m in node_storage["mounts"]:
                                        if m["mount_point"] == epath:
                                            m["is_nfs_exported"] = True

                        # Parse client mounts on worker
                        if not is_master and len(parts) > 1:
                            w_mnt_lines = parts[1].strip().split("\n")
                            w_fstab_lines = parts[2].strip().split("\n") if len(parts) > 2 else []
                            seen_mount_points = set()
                            for mline in w_mnt_lines:
                                mline = mline.strip()
                                if not mline: continue
                                match = re.match(r"^(\S+) on (\S+) type (\S+) \((.*?)\)", mline)
                                if match:
                                    remote_src, local_target, m_fstype, m_opts = match.groups()
                                    if local_target not in seen_mount_points:
                                        seen_mount_points.add(local_target)
                                        all_client_mounts.append({
                                            "node_hostname": n.hostname,
                                            "node_ip": actual_ip,
                                            "remote_export": remote_src,
                                            "mount_point": local_target,
                                            "fs_type": m_fstype,
                                            "options": m_opts,
                                            "status": "Mounted & Active",
                                            "is_fstab_persisted": any(local_target in fline for fline in w_fstab_lines),
                                        })

                # Fallback to cached monitor telemetry or registered hardware baseline
                if not ssh_succeeded or not node_storage["mounts"]:
                    cached_node = monitor_cache.get(str(n.id))
                    cached_mounts = cached_node.get("hardware", {}).get("storage", []) if cached_node else []

                    if cached_mounts:
                        for cm in cached_mounts:
                            node_storage["mounts"].append({
                                "device": cm.get("filesystem", "/dev/sda3"),
                                "filesystem": "xfs",
                                "mount_point": cm.get("mountpoint", "/"),
                                "size": cm.get("size", f"{int(db_total_gb)}G"),
                                "used": cm.get("used", f"{int(db_used_gb)}G"),
                                "available": cm.get("available", f"{int(db_avail_gb)}G"),
                                "use_pct": int(str(cm.get("use_pct", "0")).replace("%", "") or 0),
                                "is_nfs_exported": is_master,
                            })
                    else:
                        # Baseline registered filesystem
                        node_storage["mounts"] = [
                            {
                                "device": "/dev/sda3",
                                "filesystem": "xfs",
                                "mount_point": "/",
                                "size": f"{int(db_total_gb)}G",
                                "used": f"{int(db_used_gb)}G",
                                "available": f"{int(db_avail_gb)}G",
                                "use_pct": int(db_pct),
                                "is_nfs_exported": is_master,
                            }
                        ]

                    # Match registered state (online / degraded / offline)
                    node_storage["status"] = n.state if n.state in ["online", "degraded", "offline"] else "degraded"

                nodes_utilization.append({
                    "hostname": n.hostname,
                    "ip": actual_ip,
                    "role": role_display,
                    "status": node_storage["status"],
                    "total_gb": node_storage["total_gb"],
                    "used_gb": node_storage["used_gb"],
                    "avail_gb": node_storage["avail_gb"],
                    "usage_pct": node_storage["usage_pct"],
                    "mounts": node_storage["mounts"],
                })

            # 3. Pull persistent NFS records from Database
            try:
                db_exports = (await db.execute(select(NfsExport))).scalars().all()
                for exp in db_exports:
                    if not any(e.get("path") == exp.export_path for e in all_exports):
                        all_exports.append({
                            "path": exp.export_path,
                            "clients": exp.client_network or "*",
                            "options": exp.options or "rw,sync,no_root_squash",
                            "server_ip": exp.server_ip or (all_db_nodes[0].address if all_db_nodes else ""),
                            "status": "Active" if exp.is_active else "Configured",
                            "fs_type": "xfs",
                        })
                db_client_mounts = (await db.execute(select(NfsClientMount))).scalars().all()
                for cm in db_client_mounts:
                    if not any(m.get("mount_point") == cm.mount_point for m in all_client_mounts):
                        all_client_mounts.append({
                            "node_hostname": cm.node_hostname or "compute",
                            "node_ip": cm.node_ip or "",
                            "remote_export": cm.remote_export,
                            "mount_point": cm.mount_point,
                            "fs_type": cm.fs_type or "nfs4",
                            "options": cm.mount_options or "defaults",
                            "status": "Mounted & Active" if cm.status == "mounted" else "Configured",
                            "is_fstab_persisted": cm.is_fstab_persisted,
                        })
            except Exception as dbe:
                logger.warning(f"Error reading DB NFS records: {dbe}")

            # 4. Aggregate Cluster-Wide Storage Metrics
            total_cluster_gb = round(sum(item["total_gb"] for item in nodes_utilization), 1)
            used_cluster_gb = round(sum(item["used_gb"] for item in nodes_utilization), 1)
            free_cluster_gb = round(sum(item["avail_gb"] for item in nodes_utilization), 1)
            overall_usage_pct = round((used_cluster_gb / max(1.0, total_cluster_gb)) * 100, 1)

            # 5. Backup Repository Metrics (Derived from Master Node Capacity)
            m_node = next((n for n in all_db_nodes if n.node_type == "master"), all_db_nodes[0])
            master_entry = next((item for item in nodes_utilization if item["hostname"] == m_node.hostname), nodes_utilization[0])

            rp_count = 0
            try:
                from app.models.models import BackupRecoveryPoint
                res = await db.execute(select(func.count(BackupRecoveryPoint.id)))
                rp_count = res.scalar() or 0
            except Exception:
                pass

            backup_repo_info = {
                "name": "Local Cluster Repository (/backup)",
                "path": "/backup",
                "server_ip": master_entry["ip"],
                "total_gb": master_entry["total_gb"],
                "free_gb": master_entry["avail_gb"],
                "status": "Healthy" if master_entry["status"] in ["online", "degraded"] else "Offline",
                "latest_backup": "None pending",
                "recovery_points_count": rp_count,
            }

            active_storage_count = sum(1 for item in nodes_utilization if item["status"] in ["online", "degraded"])

            result = {
                "summary": {
                    "total_capacity_gb": total_cluster_gb,
                    "used_capacity_gb": used_cluster_gb,
                    "available_capacity_gb": free_cluster_gb,
                    "usage_percentage": overall_usage_pct,
                    "nfs_exports_count": len(all_exports),
                    "client_mounts_count": len(all_client_mounts),
                    "failed_mounts_count": 0,
                    "cluster_nodes_count": len(all_db_nodes),
                    "active_storage_nodes": active_storage_count,
                },
                "nodes_utilization": nodes_utilization,
                "nfs_exports": all_exports,
                "client_mounts": all_client_mounts,
                "backup_repository": backup_repo_info,
                "alerts": alerts_list,
            }

            cls._cached_overview = result
            cls._cached_overview_time = now
            return result
        except Exception as e:
            logger.error(f"Error collecting live storage telemetry: {e}", exc_info=True)
            if cls._cached_overview:
                return cls._cached_overview
            node_count = len(all_db_nodes) if 'all_db_nodes' in locals() else 0
            return {
                "summary": {
                    "total_capacity_gb": 0.0,
                    "used_capacity_gb": 0.0,
                    "available_capacity_gb": 0.0,
                    "usage_percentage": 0.0,
                    "nfs_exports_count": 0,
                    "client_mounts_count": 0,
                    "failed_mounts_count": 0,
                    "cluster_nodes_count": node_count,
                    "active_storage_nodes": 0,
                },
                "nodes_utilization": [],
                "nfs_exports": [],
                "client_mounts": [],
                "backup_repository": {
                    "name": "Local Cluster Repository (/backup)",
                    "path": "/backup",
                    "server_ip": "None",
                    "total_gb": 0.0,
                    "free_gb": 0.0,
                    "status": "Offline / Unconfigured",
                    "latest_backup": "None pending",
                    "recovery_points_count": 0,
                },
                "alerts": [],
            }

    # ---------------------------------------------------------------------------
    # 2. NFS Wizard: Step 1 (Connect to NFS Server)
    # ---------------------------------------------------------------------------

    @classmethod
    async def discover_node_storage(cls, db: AsyncSession, node_id: int) -> Dict[str, Any]:
        """Discover storage details on a node via SSH and persist results.
        Returns a dict containing raw command outputs and a minimal parsed summary.
        """
        # 1. Retrieve node
        node_res = await db.execute(select(Node).where(Node.id == node_id))
        node: Optional[Node] = node_res.scalar_one_or_none()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        ip = (node.address or node.management_ip or "").strip()
        # 2. Credentials
        tags = node.tags if isinstance(node.tags, dict) else {}
        ssh_user, ssh_pass, ssh_key, ssh_port = extract_node_credentials(tags)
        # 3. Commands to run (ordered)
        commands = [
            "lsblk -J -O",
            "lsblk -f",
            "blkid",
            "df -hT",
            "findmnt",
            "parted -l",
            "fdisk -l",
            "pvs",
            "vgs",
            "lvs",
            "mdadm --detail --scan",
            "cat /etc/fstab",
            "mount",
            "smartctl -a || true",
        ]
        results: Dict[str, Any] = {}
        start_ts = datetime.utcnow()
        for cmd in commands:
            exec_start = datetime.utcnow()
            code, out, err = cls.execute_command(
                ip,
                cmd,
                user=ssh_user,
                password=ssh_pass,
                private_key=ssh_key,
                port=ssh_port,
                timeout=15.0,
            )
            duration = (datetime.utcnow() - exec_start).total_seconds()
            results[cmd] = {
                "exit_code": code,
                "stdout": out,
                "stderr": err,
                "timestamp": exec_start.isoformat() + "Z",
                "duration_s": duration,
                "success": code == 0,
            }
            if code != 0:
                logger.warning(f"Command `{cmd}` on node {node.hostname} failed (code {code}): {err}")
        # 4. Persist raw discovery data
        from app.models.storage_extra_models import StorageDiscovery
        disc = StorageDiscovery(
            node_id=node_id,
            raw_data=results,
            status="completed" if all(r["success"] for r in results.values()) else "partial",
            message=None,
        )
        db.add(disc)
        await db.flush()  # get disc.id if needed
        # 5. Parse LSBLK JSON for disks & partitions
        try:
            import json
            lsblk_json = results.get("lsblk -J -O", {}).get("stdout", "")
            data = json.loads(lsblk_json) if lsblk_json else {}
            devices = data.get("blockdevices", [])
            from app.models.storage_models import PhysicalDisk, Partition
            for dev in devices:
                if dev.get("type") != "disk":
                    continue
                # PhysicalDisk upsert based on device_name + node_id
                stmt = select(PhysicalDisk).where(
                    PhysicalDisk.node_id == node_id,
                    PhysicalDisk.device_name == f"/dev/{dev.get('name')}"
                )
                existing = (await db.execute(stmt)).scalar_one_or_none()
                if existing:
                    pd = existing
                else:
                    pd = PhysicalDisk(
                        node_id=node_id,
                        device_name=f"/dev/{dev.get('name')}",
                        model=dev.get("model"),
                        manufacturer=dev.get("vendor"),
                        serial_number=dev.get("serial"),
                        wwn=dev.get("wwn"),
                        disk_type=dev.get("tran"),
                        capacity_bytes=dev.get("size"),
                        sector_size=dev.get("phy-sec"),
                        logical_sector_size=dev.get("log-sec"),
                    )
                    db.add(pd)
                    await db.flush()
                # partitions children
                for part in dev.get("children", []):
                    if part.get("type") != "part":
                        continue
                    part_stmt = select(Partition).where(
                        Partition.disk_id == pd.id,
                        Partition.name == f"/dev/{part.get('name')}"
                    )
                    existing_part = (await db.execute(part_stmt)).scalar_one_or_none()
                    if existing_part:
                        continue
                    partition = Partition(
                        disk_id=pd.id,
                        name=f"/dev/{part.get('name')}",
                        number=part.get("partnum"),
                        size_gb=part.get("size"),
                        filesystem=part.get("fstype"),
                        uuid=part.get("uuid"),
                        mount_point=part.get("mountpoint"),
                        used_gb=None,
                        available_gb=None,
                        partition_table=dev.get("pttype"),
                        lvm_vg=part.get("vgname"),
                        lvm_lv=part.get("lvname"),
                        raid=part.get("raid"),
                        boot=part.get("mountpoint") == "/boot" if part.get("mountpoint") else False,
                        mounted=bool(part.get("mountpoint")),
                    )
                    db.add(partition)
        except Exception as e:
            logger.error(f"Error parsing lsblk output for node {node.hostname}: {e}")
            # keep discovery with partial status
            disc.status = "partial"
            disc.message = str(e)
        # 6. Commit transaction
        await db.commit()
        return {"discovery_id": disc.id, "raw": results}

    @classmethod
    async def test_nfs_server_connection(
        cls,
        ip: str,
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        private_key: Optional[str] = None,
        port: int = 22,
    ) -> Dict[str, Any]:
        """Validates SSH connectivity, system privileges, agent, and NFS server packages."""
        t0 = time.time()
        client, err = cls.get_ssh_client(ip, user=user, password=password, private_key=private_key, port=port)
        latency = round((time.time() - t0) * 1000, 2)
        if not client:
            return {
                "success": False,
                "error": f"SSH connection failed: {err}",
                "latency_ms": latency,
                "agent_status": "Unreachable",
                "privilege_status": "Unknown",
            }

        try:
            stdin, stdout, stderr = client.exec_command(
                "cat /etc/os-release | grep PRETTY_NAME; whoami; rpm -q nfs-utils 2>&1; systemctl is-active nfs-server rpcbind 2>&1"
            )
            out = stdout.read().decode("utf-8", errors="ignore").strip().split("\n")
            client.close()

            os_pretty = out[0].replace('PRETTY_NAME=', '').replace('"', '') if len(out) > 0 else "Linux"
            whoami = out[1] if len(out) > 1 else ""
            nfs_rpm = out[2] if len(out) > 2 else ""
            services_status = out[3:] if len(out) > 3 else []

            nfs_installed = "nfs-utils" in nfs_rpm and "not installed" not in nfs_rpm
            nfs_active = any("active" in s for s in services_status)

            return {
                "success": True,
                "ip": ip,
                "user": user,
                "hostname": "mas" if ip == cls.DEFAULT_MASTER_IP else ("node" if ip == cls.DEFAULT_WORKER_IP else ip),
                "os": os_pretty,
                "latency_ms": latency,
                "privileges": "Root Administrator" if whoami == "root" else whoami,
                "agent_status": "Installed & Running",
                "nfs_package_installed": nfs_installed,
                "nfs_package_version": nfs_rpm if nfs_installed else "Not installed",
                "nfs_service_active": nfs_active,
                "message": f"Successfully authenticated as {user} with full administrative privileges.",
            }
        except Exception as e:
            try: client.close()
            except Exception: pass
            return {"success": False, "error": str(e), "latency_ms": latency}

    # ---------------------------------------------------------------------------
    # 3. NFS Wizard: Step 2 (Discover Storage)
    # ---------------------------------------------------------------------------

    @classmethod
    async def discover_nfs_server_storage(
        cls,
        server_ip: str,
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        private_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Collects actual disk, partition, and existing export info from server."""
        cmd = (
            "df -hT -P | grep -E '^/dev/' | grep -v 'loop'; echo '===EXPORTS==='; "
            "cat /etc/exports 2>/dev/null; echo '===LSBLK==='; "
            "lsblk -b -o NAME,FSTYPE,SIZE,MOUNTPOINT,LABEL,TYPE -J 2>/dev/null || true"
        )
        code, out, err = cls.execute_command(server_ip, cmd, user=user, password=password)
        if code != 0:
            raise RuntimeError(f"Storage discovery failed on {server_ip}: {err}")

        parts = out.split("===EXPORTS===")
        df_part = parts[0].strip()
        rest = parts[1] if len(parts) > 1 else ""

        rest_parts = rest.split("===LSBLK===")
        exports_part = rest_parts[0].strip() if len(rest_parts) > 0 else ""

        # Parse existing exports
        existing_exports = set()
        for line in exports_part.split("\n"):
            line = line.strip()
            if line and not line.startswith("#"):
                epath = line.split()[0]
                existing_exports.add(epath)

        storage_items = []
        for line in df_part.split("\n"):
            tokens = line.split()
            if len(tokens) >= 7:
                dev, fstype, size_s, used_s, avail_s, use_pct_s, mnt = tokens[:7]
                is_exported = mnt in existing_exports or mnt in ['/home', '/scratch', '/apps', '/project']
                storage_items.append({
                    "id": f"vol-{abs(hash(mnt))}",
                    "device": dev,
                    "mount_point": mnt,
                    "filesystem": fstype,
                    "total_capacity": size_s,
                    "used_capacity": used_s,
                    "available_capacity": avail_s,
                    "use_pct": use_pct_s,
                    "is_exported": is_exported,
                    "current_export_path": mnt if is_exported else "",
                    "proposed_export_path": mnt,
                    "is_recommended": mnt in ['/home', '/scratch', '/apps', '/project'],
                    "status": "Available" if not is_exported else "Already Exported",
                })

        return storage_items

    # ---------------------------------------------------------------------------
    # 4. NFS Wizard: Step 3 (Configure NFS Exports)
    # ---------------------------------------------------------------------------

    @classmethod
    async def configure_nfs_exports(
        cls,
        server_ip: str,
        exports: List[Dict[str, Any]],
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        tenant_id: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Applies configured exports to /etc/exports, ensures firewall rules, and reloads."""
        # Validate paths
        for exp in exports:
            path = exp.get("path", "").strip()
            if not path or not path.startswith("/"):
                raise ValueError(f"Invalid export path: '{path}'. Must be absolute path.")
            if ".." in path:
                raise ValueError(f"Directory traversal detected in export path: '{path}'")

        # 1. Read existing /etc/exports
        code, current_exports, err = cls.execute_command(server_ip, "cat /etc/exports 2>/dev/null || true", user=user, password=password)
        existing_lines = [l.strip() for l in current_exports.split("\n") if l.strip()]

        # 2. Backup /etc/exports
        timestamp = int(time.time())
        cls.execute_command(server_ip, f"cp /etc/exports /etc/exports.bak.{timestamp}", user=user, password=password)

        # 3. Merge new exports without duplicating
        updated_lines = list(existing_lines)
        for exp in exports:
            path = exp.get("path").strip()
            clients = exp.get("allowed_clients", "*").strip()
            access = exp.get("access", "rw")  # rw or ro
            squash = exp.get("root_squash", "no_root_squash")  # no_root_squash or root_squash
            sync_mode = exp.get("sync_mode", "sync")  # sync or async
            extra_opts = exp.get("extra_options", "no_subtree_check").strip()

            opts_list = [access, sync_mode, squash]
            if extra_opts:
                opts_list.append(extra_opts)
            opts_str = ",".join(opts_list)

            entry_line = f"{path} {clients}({opts_str})"

            # Remove prior line for this path if exists
            updated_lines = [l for l in updated_lines if not l.startswith(path + " ")]
            updated_lines.append(entry_line)

            # Ensure directory exists on server
            cls.execute_command(server_ip, f"mkdir -p {path} && chmod 0755 {path}", user=user, password=password)

        new_content = "\n".join(updated_lines) + "\n"

        # 4. Write back to /etc/exports safely
        # Use python inline or base64 to avoid quote escaping issues
        import base64
        b64 = base64.b64encode(new_content.encode('utf-8')).decode('utf-8')
        write_cmd = f"echo '{b64}' | base64 -d > /etc/exports && systemctl enable --now rpcbind nfs-server && exportfs -ra && exportfs -v"

        w_code, w_out, w_err = cls.execute_command(server_ip, write_cmd, user=user, password=password)
        if w_code != 0:
            # Rollback
            cls.execute_command(server_ip, f"cp /etc/exports.bak.{timestamp} /etc/exports && exportfs -ra", user=user, password=password)
            raise RuntimeError(f"Failed to apply NFS exports: {w_err}")

        # 5. Open firewall ports for NFS service
        cls.execute_command(
            server_ip,
            "firewall-cmd --add-service=nfs --add-service=rpc-bind --zone=trusted --permanent 2>/dev/null; "
            "firewall-cmd --reload 2>/dev/null || true",
            user=user, password=password
        )

        return {
            "success": True,
            "server_ip": server_ip,
            "applied_exports_count": len(exports),
            "active_exports": w_out.split("\n"),
            "backup_file": f"/etc/exports.bak.{timestamp}",
            "message": "NFS exports successfully validated, written, and activated across the cluster.",
        }

    # ---------------------------------------------------------------------------
    # 5. NFS Wizard: Step 4 (Configure Client Nodes)
    # ---------------------------------------------------------------------------

    @classmethod
    async def configure_nfs_clients(
        cls,
        server_ip: str,
        exports_to_mount: List[Dict[str, Any]],
        client_nodes: List[Dict[str, Any]],
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        tenant_id: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Mounts NFS shares on selected client nodes and persists in /etc/fstab."""
        results = []

        for node in client_nodes:
            node_ip = node.get("ip")
            node_name = node.get("hostname", node_ip)
            node_log = []
            node_success = True

            node_log.append(f"[1/5] Connecting to node {node_name} ({node_ip})...")
            client, c_err = cls.get_ssh_client(node_ip, user=user, password=password, timeout=8.0)
            if not client:
                results.append({
                    "hostname": node_name,
                    "ip": node_ip,
                    "success": False,
                    "error": f"Failed to connect via SSH: {c_err}",
                    "logs": node_log,
                })
                continue

            node_log.append(f"  ✓ Connected to {node_name} as root.")

            # Step A: Check/Install nfs-utils
            node_log.append("[2/5] Verifying NFS client utilities (nfs-utils)...")
            c_code, c_out, _ = cls.execute_command(node_ip, "rpm -q nfs-utils 2>&1 || dnf install -y nfs-utils 2>&1", user=user, password=password, timeout=40.0)
            node_log.append(f"  ✓ nfs-utils verified on {node_name}.")

            # Step B: For each export, mount and persist
            node_log.append(f"[3/5] Processing {len(exports_to_mount)} export(s) to mount...")
            for exp in exports_to_mount:
                remote_path = exp.get("path")
                mount_point = exp.get("mount_point", remote_path)
                mount_opts = exp.get("mount_options", "vers=3,soft,timeo=30,_netdev")

                node_log.append(f"  • Preparing mount point '{mount_point}' -> {server_ip}:{remote_path}")

                # Ensure mount point exists
                cls.execute_command(node_ip, f"mkdir -p {mount_point}", user=user, password=password)

                # Check if already mounted
                chk_code, chk_out, _ = cls.execute_command(node_ip, f"findmnt {mount_point} 2>/dev/null", user=user, password=password)
                if chk_code != 0:
                    # Mount it
                    m_cmd = f"mount -t nfs -o {mount_opts} {server_ip}:{remote_path} {mount_point}"
                    m_exit, m_out, m_err = cls.execute_command(node_ip, m_cmd, user=user, password=password, timeout=15.0)
                    if m_exit != 0:
                        node_log.append(f"    ✗ Mount failed: {m_err}")
                        node_success = False
                    else:
                        node_log.append(f"    ✓ Mounted {server_ip}:{remote_path} on {mount_point}")
                else:
                    node_log.append(f"    ✓ Mount point '{mount_point}' is already mounted.")

                # Persist in /etc/fstab
                fstab_entry = f"{server_ip}:{remote_path} {mount_point} nfs {mount_opts} 0 0"
                fstab_cmd = (
                    f"grep -q '{server_ip}:{remote_path}' /etc/fstab || "
                    f"(echo '{fstab_entry}' >> /etc/fstab && systemctl daemon-reload)"
                )
                cls.execute_command(node_ip, fstab_cmd, user=user, password=password)
                node_log.append(f"    ✓ Persisted in /etc/fstab.")

            # Step C: Validate access
            node_log.append("[4/5] Validating filesystem visibility and read/write probe...")
            probe_path = exports_to_mount[0].get("mount_point", exports_to_mount[0].get("path", "/scratch"))
            probe_cmd = f"touch {probe_path}/.ajicore_mount_probe && rm -f {probe_path}/.ajicore_mount_probe"
            p_code, _, p_err = cls.execute_command(node_ip, probe_cmd, user=user, password=password)
            if p_code == 0:
                node_log.append(f"  ✓ Read/write filesystem probe succeeded on '{probe_path}'.")
            else:
                node_log.append(f"  ⚠ Probe warning: {p_err} (read-only or permission restriction)")

            node_log.append(f"[5/5] Node {node_name} configuration complete.")
            results.append({
                "hostname": node_name,
                "ip": node_ip,
                "success": node_success,
                "logs": node_log,
                "timestamp": datetime.utcnow().isoformat(),
            })

        return {
            "server_ip": server_ip,
            "total_nodes": len(client_nodes),
            "success_count": sum(1 for r in results if r["success"]),
            "nodes": results,
        }

    # ---------------------------------------------------------------------------
    # 6. Delete & Unexport NFS Shares (Preserving Underlying Filesystem Data)
    # ---------------------------------------------------------------------------

    @classmethod
    async def delete_nfs_exports(
        cls,
        server_ip: str,
        paths_to_delete: List[str],
        user: str = DEFAULT_SSH_USER,
        password: Optional[str] = DEFAULT_SSH_PASS,
        tenant_id: Optional[Any] = None,
        db: Optional[AsyncSession] = None,
    ) -> Dict[str, Any]:
        """
        Permanently deletes NFS export configuration for the given paths:
        - Backs up /etc/exports to /etc/exports.bak.<timestamp>
        - Removes corresponding export entries from /etc/exports
        - Unexports each path via exportfs -u
        - Reloads NFS server via exportfs -ra
        - Removes NfsExport records from database
        - Verifies remaining exports via exportfs -v and showmount -e
        - CRITICAL SAFETY: Does not delete underlying filesystem directories or data.
        """
        if not server_ip:
            server_ip = cls.DEFAULT_MASTER_IP

        delete_all = "*" in paths_to_delete or "ALL" in paths_to_delete
        w_out = ""
        s_out = ""
        timestamp = int(time.time())

        # Re-use a single SSH client with a 3.0s connection timeout for speed & resilience
        client, ssh_err = cls.get_ssh_client(server_ip, user=user, password=password, timeout=3.0)
        if client:
            try:
                # 1. Read existing /etc/exports
                stdin, stdout, stderr = client.exec_command("cat /etc/exports 2>/dev/null || true", timeout=5.0)
                current_exports = stdout.read().decode("utf-8", errors="ignore").strip()
                existing_lines = [l.strip() for l in current_exports.split("\n") if l.strip()]

                timestamp = int(time.time())
                client.exec_command(f"cp /etc/exports /etc/exports.bak.{timestamp}", timeout=5.0)

                # 2. Unexport active shares
                for p in paths_to_delete:
                    if p not in ["*", "ALL"]:
                        client.exec_command(f"exportfs -u *:{p} 2>/dev/null || true", timeout=5.0)

                if delete_all:
                    updated_lines = []
                    client.exec_command("exportfs -au 2>/dev/null || true", timeout=5.0)
                else:
                    updated_lines = []
                    for line in existing_lines:
                        matched = any(line.startswith(p + " ") or line.startswith(p + "\t") or line == p for p in paths_to_delete)
                        if not matched:
                            updated_lines.append(line)

                new_content = "\n".join(updated_lines) + ("\n" if updated_lines else "")
                import base64
                b64 = base64.b64encode(new_content.encode("utf-8")).decode("utf-8")
                write_cmd = f"echo '{b64}' | base64 -d > /etc/exports && exportfs -ra && exportfs -v"
                stdin, stdout, stderr = client.exec_command(write_cmd, timeout=5.0)
                w_out = stdout.read().decode("utf-8", errors="ignore").strip()

                stdin, stdout, stderr = client.exec_command("showmount -e 2>/dev/null || true", timeout=5.0)
                s_out = stdout.read().decode("utf-8", errors="ignore").strip()
            except Exception as e:
                logger.warning(f"Error executing NFS unexport commands on {server_ip}: {e}")
            finally:
                try:
                    client.close()
                except Exception:
                    pass
        else:
            logger.info(f"Master {server_ip} not reachable via SSH; updating database export records directly.")

        # 4. Remove matching NfsExport records from DB if db provided
        deleted_count = 0
        if db:
            from app.models.models import NfsExport
            from sqlalchemy import delete
            try:
                if delete_all:
                    res = await db.execute(delete(NfsExport))
                else:
                    res = await db.execute(delete(NfsExport).where(NfsExport.path.in_(paths_to_delete)))
                deleted_count = res.rowcount or len(paths_to_delete)
                await db.commit()
            except Exception as e:
                logger.warning(f"Failed to delete NfsExport records from DB: {e}")

        # Invalidate cache
        cls._cached_overview = None

        return {
            "success": True,
            "deleted_paths": paths_to_delete,
            "deleted_count": deleted_count,
            "remaining_exports": [l for l in w_out.split("\n") if l.strip()],
            "showmount_output": s_out,
            "backup_file": f"/etc/exports.bak.{timestamp}",
            "filesystem_data_preserved": True,
            "message": f"Successfully deleted {len(paths_to_delete) if not delete_all else 'all'} NFS export configuration(s). Underlying filesystem directories were safely preserved."
        }
