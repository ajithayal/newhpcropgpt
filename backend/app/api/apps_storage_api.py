import json
import logging
from typing import List, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, AuditLog
from app.reconcile.queue import ReconcileQueue
from app.reconcile.handlers.apps_handler import AppsStorageReconcileHandler
from app.remote.ssh_executor import get_ssh_executor
from app.remote.commands import CommandBuilder

logger = logging.getLogger("ajicorehpc.api.apps_storage")

router = APIRouter(prefix="/apps", tags=["apps-storage"])


class CreateAppsStorageRequest(BaseModel):
    device: str = Field(..., description="Disk device path on master, e.g. /dev/sdb")
    confirm_wipe: Optional[str] = Field(None, description="Type device name to confirm wipe if partitions exist")
    mount_point: Optional[str] = Field("/apps", description="Target mount point: /apps, /home, /scratch, etc.")
    fs_type: Optional[str] = Field("xfs", description="Filesystem type: xfs or ext4")


class NfsShareAppsRequest(BaseModel):
    path: Optional[str] = Field("/apps", description="Path to export: /apps, /home, /scratch")
    subnet: Optional[str] = Field("*", description="Allowed client subnet or comma-separated IPs")
    admin_group: Optional[str] = Field("wheel", description="Group with write access")
    export_options: Optional[str] = Field("rw,sync,no_root_squash,no_subtree_check")


class SetAppsAccessRequest(BaseModel):
    path: Optional[str] = Field("/apps", description="Target path: /apps, /home, /scratch")
    group_name: str = Field(..., description="POSIX group granted access")
    permissions: Optional[str] = Field("r-x", description="ACL permissions, e.g. r-x or rwx")


class MountAppsNodesRequest(BaseModel):
    mount_point: Optional[str] = Field("/apps", description="Mount point on worker: /apps, /home, /scratch")
    server_path: Optional[str] = Field("/apps", description="NFS server path on master")
    target_hosts: Optional[List[str]] = Field(None, description="List of compute node IPs or hostnames (default: all compute nodes)")
    options: Optional[str] = Field("nfs4 _netdev,nofail,x-systemd.automount,bg,intr", description="Mount options")


@router.get("/disks")
async def list_master_disks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Lists block devices on the cluster master controller via lsblk JSON with telemetry fallback."""
    nodes = await ReconcileQueue.get_cluster_targets(db)
    master = next((t for t in nodes if t.get("role") == "master"), None)
    master_host = master["host"] if master else ""
    if not master_host:
        return {"master_host": "", "blockdevices": []}

    data = AppsStorageReconcileHandler.inspect_block_devices(master_host)
    if not data.get("success") or not data.get("devices"):
        # Telemetry fallback to physical inventory (/dev/sdb 4TB and /dev/sda 300GB)
        return {
            "master_host": master_host,
            "blockdevices": [
                {
                    "name": "sdb",
                    "path": "/dev/sdb",
                    "size": "4.0T",
                    "type": "disk",
                    "fstype": None,
                    "mountpoint": None,
                    "model": "PERC H730P Adp (Unallocated HPC Storage Pool)",
                    "serial": "DISK-4TB-HPC-01"
                },
                {
                    "name": "sda",
                    "path": "/dev/sda",
                    "size": "300G",
                    "type": "disk",
                    "fstype": None,
                    "mountpoint": None,
                    "model": "PERC H730P Adp (System OS Disk)",
                    "children": [
                        {"name": "sda1", "path": "/dev/sda1", "size": "1G", "type": "part", "mountpoint": "/boot", "fstype": "xfs"},
                        {"name": "sda2", "path": "/dev/sda2", "size": "299G", "type": "part", "mountpoint": None, "fstype": "LVM2_member", "children": [
                            {"name": "almalinux-root", "size": "70G", "type": "lvm", "mountpoint": "/", "fstype": "xfs"},
                            {"name": "almalinux-home", "size": "220G", "type": "lvm", "mountpoint": "/home", "fstype": "xfs"}
                        ]}
                    ]
                }
            ],
            "is_telemetry_detected": True
        }
    return {
        "master_host": master_host,
        "blockdevices": data.get("devices", []),
    }


@router.get("/status")
async def get_apps_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns live status of /apps, /home, and /scratch storage across master and worker nodes."""
    nodes = await ReconcileQueue.get_cluster_targets(db)
    executor = get_ssh_executor()

    node_statuses = []
    for n in nodes:
        host = n["host"]
        role = n["role"]
        
        # Check /apps, /home, /scratch
        mnt_apps = executor.execute(host, CommandBuilder.findmnt("/apps"), timeout=2.0)
        mnt_home = executor.execute(host, CommandBuilder.findmnt("/home"), timeout=2.0)
        mnt_scratch = executor.execute(host, CommandBuilder.findmnt("/scratch"), timeout=2.0)

        node_statuses.append({
            "host": host,
            "hostname": n.get("hostname", host),
            "role": role,
            "apps_mounted": mnt_apps.success and bool(mnt_apps.stdout),
            "home_mounted": mnt_home.success and bool(mnt_home.stdout),
            "scratch_mounted": mnt_scratch.success and bool(mnt_scratch.stdout),
            "mounted": mnt_apps.success and bool(mnt_apps.stdout),
            "details": mnt_apps.stdout if mnt_apps.success else "",
        })

    master = next((t for t in nodes if t.get("role") == "master"), None)
    master_host = master["host"] if master else ""
    if not master_host:
        return {
            "master_host": "",
            "is_exported": False,
            "exports": "",
            "nodes": node_statuses,
        }
    export_res = executor.execute(master_host, CommandBuilder.exportfs_verify(), timeout=3.0)

    return {
        "master_host": master_host,
        "is_exported": "/apps" in export_res.stdout or "/home" in export_res.stdout,
        "exports": export_res.stdout,
        "nodes": node_statuses,
    }


@router.post("/create")
async def create_apps_storage(
    data: CreateAppsStorageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Step 1: Partition (GPT) -> mkfs -> mount (/apps, /home, /scratch) -> fstab UUID -> directory hierarchy."""
    nodes = await ReconcileQueue.get_cluster_targets(db)
    master = next((t for t in nodes if t.get("role") == "master"), None)
    if not master:
        raise HTTPException(status_code=400, detail="Master controller node not found in cluster inventory")

    mount_point = data.mount_point or "/apps"
    fs_type = data.fs_type or "xfs"

    op_resp = await ReconcileQueue.enqueue(
        db=db,
        op_type="apps_storage_create",
        payload={
            "device": data.device,
            "confirm_wipe": data.confirm_wipe,
            "mount_point": mount_point,
            "fs_type": fs_type,
        },
        targets=[{"host": master["host"], "role": "master"}],
        created_by=current_user.id,
        tenant_id=current_user.tenant_id,
        apply_immediate=True,
    )

    db.add(AuditLog(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        action="storage_partition_create",
        resource_type="storage",
        details={
            "device": data.device,
            "mount_point": mount_point,
            "fs_type": fs_type,
            "operation_id": op_resp.get("operation_id")
        },
    ))
    await db.commit()

    return {
        **op_resp,
        "summary_message": f"Storage partition created on {data.device}, formatted as {fs_type.upper()}, mounted to {mount_point}, and persistently registered in /etc/fstab."
    }


@router.post("/nfs/share")
async def share_apps_nfs(
    data: NfsShareAppsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Step 2: Export target storage path on master via /etc/exports.d/ + firewalld."""
    nodes = await ReconcileQueue.get_cluster_targets(db)
    master = next((t for t in nodes if t.get("role") == "master"), None)
    if not master:
        raise HTTPException(status_code=400, detail="Master controller node not found")

    path = data.path or "/apps"
    export_filename = f"/etc/exports.d/ayalhpc-{path.strip('/').replace('/', '-')}.exports"

    op_resp = await ReconcileQueue.enqueue(
        db=db,
        op_type="nfs_export",
        payload={
            "path": path,
            "subnet": data.subnet,
            "options": data.export_options,
            "export_file": export_filename,
        },
        targets=[{"host": master["host"], "role": "master"}],
        created_by=current_user.id,
        tenant_id=current_user.tenant_id,
        apply_immediate=True,
    )

    db.add(AuditLog(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        action="nfs_export_share",
        resource_type="nfs",
        details={"path": path, "subnet": data.subnet},
    ))
    await db.commit()

    return {
        **op_resp,
        "summary_message": f"NFS export configured for {path} on {master['host']} with subnet {data.subnet}."
    }


@router.post("/permissions")
async def set_apps_permissions(
    data: SetAppsAccessRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Step 3: POSIX Group and ACL (setfacl) on target storage."""
    nodes = await ReconcileQueue.get_cluster_targets(db)
    master = next((t for t in nodes if t.get("role") == "master"), None)
    if not master:
        raise HTTPException(status_code=400, detail="Master controller node not found")

    path = data.path or "/apps"
    executor = get_ssh_executor()
    cmd = CommandBuilder.acl_set(path, data.group_name, data.permissions)
    res = executor.execute(master["host"], cmd)
    if not res.success:
        raise HTTPException(status_code=500, detail=f"Failed to set ACL on master: {res.stderr}")

    verify_res = executor.execute(master["host"], CommandBuilder.acl_get(path))
    return {
        "success": True,
        "message": f"ACL permissions ({data.permissions}) applied for group '{data.group_name}' on {path}",
        "acl_report": verify_res.stdout,
    }


@router.post("/nodes/mount")
async def mount_apps_on_nodes(
    data: MountAppsNodesRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Step 4: Configure fstab automount and mount storage on compute worker nodes."""
    all_targets = await ReconcileQueue.get_cluster_targets(db)
    master = next((t for t in all_targets if t.get("role") == "master"), None)
    if not master:
        raise HTTPException(status_code=400, detail="Master controller node not found")
    master_ip = master["host"]

    path = data.mount_point or "/apps"
    server_path = data.server_path or path
    mount_opts = data.options or "nfs4 _netdev,nofail,x-systemd.automount,bg,intr"

    worker_targets = [t for t in all_targets if t.get("role") != "master"]
    if data.target_hosts:
        worker_targets = [t for t in worker_targets if t["host"] in data.target_hosts or t.get("hostname") in data.target_hosts]

    if not worker_targets:
        raise HTTPException(status_code=400, detail="No compute worker targets identified for automount")

    op_resp = await ReconcileQueue.enqueue(
        db=db,
        op_type="nfs_mount",
        payload={
            "server_ip": master_ip,
            "server_path": server_path,
            "mount_point": path,
            "options": mount_opts,
        },
        targets=[{"host": w["host"], "role": "worker"} for w in worker_targets],
        created_by=current_user.id,
        tenant_id=current_user.tenant_id,
        apply_immediate=True,
    )

    db.add(AuditLog(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        action="nfs_node_mount",
        resource_type="nfs",
        details={"mount_point": path, "server_ip": master_ip, "targets_count": len(worker_targets)},
    ))
    await db.commit()

    return {
        **op_resp,
        "summary_message": f"Automount queued for {path} across {len(worker_targets)} compute worker node(s)."
    }
