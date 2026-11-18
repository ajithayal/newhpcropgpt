"""
AYAL HPC – Centralized Agent Data Collection API
Endpoints for:
- Ingesting comprehensive node telemetry reports (/api/agent/report)
- Fast heartbeat signals (/api/agent/heartbeat)
- Agent install script generation (/api/agent/install-script)
- Agent configuration distribution (/api/agent/config/{node_id})
"""
import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    Cluster,
    Node,
    NodeMetric,
    NodeNetworkMetric,
    NodeStorageMetric,
    NodeGpuMetric,
    NodeServiceStatus,
    NodeApplication,
    SlurmClusterMetric,
    AgentStatus,
    MonitoringAlert,
)

logger = logging.getLogger("ayalhpc.agent_api")
router = APIRouter(prefix="/agent", tags=["agent-monitoring"])


# ---------------------------------------------------------------------------
# Request Schemas
# ---------------------------------------------------------------------------

class AgentHeartbeatRequest(BaseModel):
    node_id: Optional[str] = None
    hostname: str
    ip_address: Optional[str] = None
    agent_version: Optional[str] = "1.0.0"
    uptime_seconds: Optional[int] = 0
    timestamp: Optional[str] = None


class AgentReportRequest(BaseModel):
    cluster_id: Optional[str] = None
    node_id: Optional[str] = None
    hostname: str
    role: Optional[str] = "compute"
    ip_address: Optional[str] = None
    timestamp: Optional[str] = None
    agent_version: Optional[str] = "1.0.0"
    
    hardware: Optional[Dict[str, Any]] = None
    os: Optional[Dict[str, Any]] = None
    system: Optional[Dict[str, Any]] = None
    metrics: Optional[Dict[str, Any]] = None
    network: Optional[Union[Dict[str, Any], List[Dict[str, Any]]]] = None
    storage: Optional[Union[Dict[str, Any], List[Dict[str, Any]]]] = None
    services: Optional[List[Dict[str, Any]]] = None
    slurm: Optional[Dict[str, Any]] = None
    applications: Optional[List[Dict[str, Any]]] = None
    gpu: Optional[Union[Dict[str, Any], List[Dict[str, Any]]]] = None
    gpus: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Helper: Resolve or auto-register node
# ---------------------------------------------------------------------------

async def _resolve_or_create_node(
    db: AsyncSession,
    node_id: Optional[str],
    hostname: str,
    ip_address: Optional[str],
    role: str = "compute",
    cluster_id: Optional[str] = None,
) -> Node:
    """Finds an existing node by UUID, hostname, or IP; creates one if registered."""
    node = None
    if node_id:
        try:
            n_uuid = uuid.UUID(node_id)
            res = await db.execute(select(Node).where(Node.id == n_uuid))
            node = res.scalar_one_or_none()
        except ValueError:
            pass

    if not node and hostname:
        res = await db.execute(select(Node).where(Node.hostname == hostname))
        node = res.scalar_one_or_none()

    if not node and ip_address:
        res = await db.execute(select(Node).where(Node.address == ip_address))
        node = res.scalar_one_or_none()

    if not node:
        # Auto-register node if reported by agent
        target_cluster_id = None
        if cluster_id:
            try:
                target_cluster_id = uuid.UUID(cluster_id)
            except ValueError:
                pass
        if not target_cluster_id:
            c_res = await db.execute(select(Cluster).limit(1))
            first_cluster = c_res.scalar_one_or_none()
            if first_cluster:
                target_cluster_id = first_cluster.id

        node = Node(
            id=uuid.uuid4(),
            hostname=hostname,
            address=ip_address or "127.0.0.1",
            node_type=role or ("master" if "master" in hostname.lower() else "compute"),
            state="online",
            cluster_id=target_cluster_id,
            last_seen=datetime.utcnow(),
        )
        db.add(node)
        await db.flush()
        logger.info(f"Registered new node via agent report: {hostname} ({node.id})")

    return node


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/heartbeat")
async def receive_heartbeat(
    payload: AgentHeartbeatRequest,
    db: AsyncSession = Depends(get_db),
):
    """Fast agent heartbeat signal (every 5-10s). Updates node state and AgentStatus."""
    node = await _resolve_or_create_node(
        db,
        node_id=payload.node_id,
        hostname=payload.hostname,
        ip_address=payload.ip_address,
    )

    now = datetime.utcnow()
    node.state = "online"
    node.last_seen = now

    # Update AgentStatus
    astat_res = await db.execute(select(AgentStatus).where(AgentStatus.node_id == node.id))
    astat = astat_res.scalar_one_or_none()
    if not astat:
        astat = AgentStatus(
            node_id=node.id,
            cluster_id=node.cluster_id,
            agent_version=payload.agent_version or "1.0.0",
            status="online",
            last_heartbeat=now,
            uptime_seconds=payload.uptime_seconds or 0,
        )
        db.add(astat)
    else:
        astat.status = "online"
        astat.last_heartbeat = now
        astat.agent_version = payload.agent_version or astat.agent_version
        astat.uptime_seconds = payload.uptime_seconds or astat.uptime_seconds

    await db.commit()
    return {"status": "acknowledged", "node_id": str(node.id), "timestamp": now.isoformat()}


@router.post("/report")
async def receive_agent_report(
    payload: AgentReportRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Ingest complete, authoritative telemetry report from AYAL Monitoring Agent.
    Stores hardware inventory, timeseries metrics, storage, network, services, Slurm, and packages.
    """
    node = await _resolve_or_create_node(
        db,
        node_id=payload.node_id,
        hostname=payload.hostname,
        ip_address=payload.ip_address,
        role=payload.role or "compute",
        cluster_id=payload.cluster_id,
    )

    now = datetime.utcnow()
    metrics_data = payload.metrics or {}
    hw_data = payload.hardware or {}
    os_data = payload.os or payload.system or {}
    net_data = payload.network or {}
    stor_data = payload.storage or {}

    # 1. Update Core Node Record
    cpu_pct = float(metrics_data.get("cpu_utilization_pct") or metrics_data.get("cpu_usage_pct") or hw_data.get("cpu_usage_pct", 0.0) or 0.0)
    ram_pct = float(metrics_data.get("memory_utilization_pct") or metrics_data.get("ram_utilization_pct") or hw_data.get("memory_usage_pct", 0.0) or 0.0)
    cpu_temp = float(hw_data.get("cpu_temp") or hw_data.get("cpu_temp_c") or 0.0) if (hw_data.get("cpu_temp") is not None or hw_data.get("cpu_temp_c") is not None) else None
    
    node.state = "online"
    node.last_seen = now
    node.cpu_usage = cpu_pct
    node.memory_usage = ram_pct
    if cpu_temp:
        node.temperature = cpu_temp
    
    if os_data.get("uptime_seconds"):
        node.uptime = str(os_data["uptime_seconds"])
    
    if hw_data.get("cpu_cores"):
        node.cpus = int(hw_data["cpu_cores"])
    
    if hw_data.get("ram_total_bytes"):
        node.memory_gb = round(hw_data["ram_total_bytes"] / (1024 ** 3), 1)

    # 2. Insert NodeMetric (Timeseries Snapshot)
    ram_total_mb = int(hw_data.get("ram_total_bytes", 0) / (1024 ** 2)) if hw_data.get("ram_total_bytes") else 0
    ram_used_mb = int(hw_data.get("ram_used_bytes", 0) / (1024 ** 2)) if hw_data.get("ram_used_bytes") else 0
    ram_free_mb = int(hw_data.get("ram_free_bytes", 0) / (1024 ** 2)) if hw_data.get("ram_free_bytes") else 0

    metric_entry = NodeMetric(
        node_id=node.id,
        cluster_id=node.cluster_id,
        timestamp=now,
        cpu_utilization=cpu_pct,
        cpu_temp_c=cpu_temp,
        load_1m=float(os_data.get("load_1m", 0.0) or 0.0),
        load_5m=float(os_data.get("load_5m", 0.0) or 0.0),
        load_15m=float(os_data.get("load_15m", 0.0) or 0.0),
        memory_total_mb=ram_total_mb,
        memory_used_mb=ram_used_mb,
        memory_available_mb=ram_free_mb,
        memory_utilization=ram_pct,
        uptime_seconds=int(os_data.get("uptime_seconds", 0) or 0),
        process_count=int(os_data.get("running_processes", 0) or 0),
        is_live=True,
    )
    db.add(metric_entry)

    # 3. Store Network Interfaces Telemetry
    if isinstance(net_data, list):
        interfaces = net_data
    elif isinstance(net_data, dict):
        interfaces = net_data.get("interfaces", [])
    else:
        interfaces = []

    if isinstance(interfaces, list):
        for iface in interfaces:
            net_metric = NodeNetworkMetric(
                node_id=node.id,
                cluster_id=node.cluster_id,
                timestamp=now,
                interface_name=iface.get("interface_name") or iface.get("name") or iface.get("interface", "eth0"),
                ip_address=iface.get("ip_address"),
                mac_address=iface.get("mac_address") or iface.get("mac"),
                link_status=iface.get("status") or iface.get("link_status", "up"),
                speed_mbps=str(iface.get("speed_mbps") or ""),
                rx_bytes_sec=float(iface.get("rx_bytes_sec") or iface.get("rx_bytes", 0.0) or 0.0),
                tx_bytes_sec=float(iface.get("tx_bytes_sec") or iface.get("tx_bytes", 0.0) or 0.0),
                rx_errors=int(iface.get("rx_errors", 0) or 0),
                tx_errors=int(iface.get("tx_errors", 0) or 0),
                rx_drops=int(iface.get("rx_drops", 0) or 0),
                tx_drops=int(iface.get("tx_drops", 0) or 0),
            )
            db.add(net_metric)

    # 4. Store Storage Mounts Telemetry
    if isinstance(stor_data, list):
        mounts = stor_data
    elif isinstance(stor_data, dict):
        mounts = stor_data.get("mounts", [])
    else:
        mounts = []

    total_disk_bytes = 0
    used_disk_bytes = 0
    if isinstance(mounts, list):
        for m in mounts:
            t_bytes = int(m.get("total_bytes", 0) or 0)
            u_bytes = int(m.get("used_bytes", 0) or 0)
            f_bytes = int(m.get("free_bytes", 0) or 0)
            total_disk_bytes += t_bytes
            used_disk_bytes += u_bytes
            
            stor_metric = NodeStorageMetric(
                node_id=node.id,
                cluster_id=node.cluster_id,
                timestamp=now,
                mount_point=m.get("mount_point", "/"),
                filesystem=m.get("filesystem", ""),
                fs_type=m.get("fs_type", "xfs"),
                total_bytes=t_bytes,
                used_bytes=u_bytes,
                free_bytes=f_bytes,
                utilization_pct=float(m.get("utilization_pct", 0.0) or 0.0),
                read_bytes_sec=float(m.get("read_bytes_sec", 0.0) or 0.0),
                write_bytes_sec=float(m.get("write_bytes_sec", 0.0) or 0.0),
                nfs_status=m.get("nfs_status", "connected" if "nfs" in m.get("fs_type", "").lower() else "local"),
            )
            db.add(stor_metric)

    if total_disk_bytes > 0:
        node.disk_total_gb = round(total_disk_bytes / (1024 ** 3), 1)
        node.disk_used_gb = round(used_disk_bytes / (1024 ** 3), 1)

    # 5. Store GPU Metrics (if discrete GPUs present)
    raw_gpus = payload.gpu or payload.gpus or hw_data.get("gpus", [])
    if isinstance(raw_gpus, dict):
        raw_gpus = [raw_gpus]
    if isinstance(raw_gpus, list) and len(raw_gpus) > 0:
        node.gpus = len(raw_gpus)
        for g in raw_gpus:
            gpu_metric = NodeGpuMetric(
                node_id=node.id,
                cluster_id=node.cluster_id,
                timestamp=now,
                gpu_index=int(g.get("index", 0) or 0),
                gpu_name=g.get("name", "NVIDIA GPU"),
                driver_version=g.get("driver_version"),
                utilization_pct=float(g.get("utilization_pct", 0.0) or 0.0),
                memory_total_mb=int(g.get("memory_total_mb", 0) or 0),
                memory_used_mb=int(g.get("memory_used_mb", 0) or 0),
                memory_free_mb=int(g.get("memory_free_mb", 0) or 0),
                temperature_c=float(g.get("temperature_c", 0.0) or 0.0),
                power_watts=float(g.get("power_watts", 0.0) or 0.0),
            )
            db.add(gpu_metric)

    # 6. Upsert HPC Services Status
    services = payload.services or []
    if isinstance(services, list):
        for s in services:
            s_name = s.get("service_name") or s.get("name")
            if not s_name:
                continue
            svc_res = await db.execute(
                select(NodeServiceStatus)
                .where(NodeServiceStatus.node_id == node.id)
                .where(NodeServiceStatus.service_name == s_name)
            )
            existing_svc = svc_res.scalar_one_or_none()
            if not existing_svc:
                existing_svc = NodeServiceStatus(
                    node_id=node.id,
                    cluster_id=node.cluster_id,
                    service_name=s_name,
                    display_name=s.get("display_name") or s_name,
                    status=s.get("status", "unknown"),
                    enabled=str(s.get("enabled", "unknown")),
                    version=s.get("version"),
                    last_checked=now,
                    error_message=s.get("error"),
                )
                db.add(existing_svc)
            else:
                existing_svc.display_name = s.get("display_name") or existing_svc.display_name or s_name
                existing_svc.status = s.get("status", existing_svc.status)
                existing_svc.enabled = str(s.get("enabled", existing_svc.enabled))
                existing_svc.version = s.get("version") or existing_svc.version
                existing_svc.last_checked = now
                existing_svc.error_message = s.get("error")

            # Alert on critical service failure
            if s_name in ["slurmctld", "slurmd", "munge", "chronyd"] and s.get("status") in ["failed", "stopped"]:
                await _raise_alert(
                    db,
                    cluster_id=node.cluster_id,
                    node_id=node.id,
                    alert_type="service_failed",
                    severity="critical" if s_name in ["slurmctld", "munge"] else "warning",
                    title=f"Critical Service Failed: {s_name}",
                    message=f"Service '{s_name}' on node '{node.hostname}' is currently {s.get('status')}. Error: {s.get('error') or 'Daemon stopped'}",
                    current_value=s.get("status"),
                )

    # 7. Upsert Installed Applications / Packages
    apps = payload.applications or []
    if isinstance(apps, list) and len(apps) > 0:
        for app in apps:
            app_name = app.get("name")
            app_ver = app.get("version", "1.0.0")
            app_src = app.get("source", "rpm")
            if not app_name:
                continue
            app_res = await db.execute(
                select(NodeApplication)
                .where(NodeApplication.node_id == node.id)
                .where(NodeApplication.name == app_name)
                .where(NodeApplication.version == app_ver)
                .where(NodeApplication.source == app_src)
            )
            existing_app = app_res.scalar_one_or_none()
            if not existing_app:
                existing_app = NodeApplication(
                    node_id=node.id,
                    cluster_id=node.cluster_id,
                    name=app_name,
                    version=app_ver,
                    source=app_src,
                    path=app.get("path"),
                    package_manager=app.get("package_manager", "dnf"),
                    status=app.get("status", "installed"),
                    last_synced=now,
                )
                db.add(existing_app)
            else:
                existing_app.status = app.get("status", existing_app.status)
                existing_app.last_synced = now

    # 8. Slurm Metrics
    slurm_data = payload.slurm or {}
    if slurm_data:
        slurm_metric = SlurmClusterMetric(
            cluster_id=node.cluster_id,
            timestamp=now,
            controller_status=slurm_data.get("controller_status", "unknown"),
            controller_version=slurm_data.get("version"),
            total_nodes=slurm_data.get("total_nodes", 0),
            active_nodes=slurm_data.get("active_nodes", 0),
            drain_nodes=slurm_data.get("drain_nodes", 0),
            down_nodes=slurm_data.get("down_nodes", 0),
            total_cpus=slurm_data.get("available_cpus", 0),
            allocated_cpus=slurm_data.get("allocated_cpus", 0),
            running_jobs=slurm_data.get("running_jobs", 0),
            pending_jobs=slurm_data.get("pending_jobs", 0),
            failed_jobs=slurm_data.get("failed_jobs", 0),
            partitions_data=slurm_data.get("partitions"),
            node_states_data=slurm_data.get("node_states"),
            job_queue_data=slurm_data.get("job_queue"),
        )
        db.add(slurm_metric)

    # 9. Update AgentStatus
    astat_res = await db.execute(select(AgentStatus).where(AgentStatus.node_id == node.id))
    astat = astat_res.scalar_one_or_none()
    if not astat:
        astat = AgentStatus(
            node_id=node.id,
            cluster_id=node.cluster_id,
            agent_version=payload.agent_version or "1.0.0",
            status="online",
            last_heartbeat=now,
            uptime_seconds=int(os_data.get("uptime_seconds", 0) or 0),
        )
        db.add(astat)
    else:
        astat.status = "online"
        astat.last_heartbeat = now
        astat.agent_version = payload.agent_version or astat.agent_version
        astat.uptime_seconds = int(os_data.get("uptime_seconds", 0) or 0)

    # 10. Automated Threshold Alerts
    if cpu_pct >= 90.0:
        await _raise_alert(
            db,
            cluster_id=node.cluster_id,
            node_id=node.id,
            alert_type="high_cpu",
            severity="critical" if cpu_pct >= 95.0 else "warning",
            title=f"High CPU Utilization: {cpu_pct:.1f}%",
            message=f"Node '{node.hostname}' has sustained CPU utilization of {cpu_pct:.1f}% exceeding the 90% threshold.",
            threshold="90%",
            current_value=f"{cpu_pct:.1f}%",
        )
    else:
        await _resolve_alert_type(db, node.id, "high_cpu")

    if ram_pct >= 90.0:
        await _raise_alert(
            db,
            cluster_id=node.cluster_id,
            node_id=node.id,
            alert_type="high_memory",
            severity="critical" if ram_pct >= 95.0 else "warning",
            title=f"High Memory Utilization: {ram_pct:.1f}%",
            message=f"Node '{node.hostname}' RAM usage reached {ram_pct:.1f}% exceeding the 90% threshold.",
            threshold="90%",
            current_value=f"{ram_pct:.1f}%",
        )
    else:
        await _resolve_alert_type(db, node.id, "high_memory")

    await db.commit()
    return {
        "status": "success",
        "node_id": str(node.id),
        "cluster_id": str(node.cluster_id) if node.cluster_id else None,
        "recorded_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Alert Helper Functions
# ---------------------------------------------------------------------------

async def _raise_alert(
    db: AsyncSession,
    cluster_id: Optional[uuid.UUID],
    node_id: uuid.UUID,
    alert_type: str,
    severity: str,
    title: str,
    message: str,
    threshold: Optional[str] = None,
    current_value: Optional[str] = None,
):
    """Creates or updates an active alert to prevent duplicate flood."""
    q = (
        select(MonitoringAlert)
        .where(MonitoringAlert.node_id == node_id)
        .where(MonitoringAlert.alert_type == alert_type)
        .where(MonitoringAlert.is_resolved == False)
    )
    res = await db.execute(q)
    existing = res.scalar_one_or_none()
    if existing:
        existing.current_value = current_value
        existing.message = message
        existing.severity = severity
    else:
        alert = MonitoringAlert(
            cluster_id=cluster_id,
            node_id=node_id,
            alert_type=alert_type,
            severity=severity,
            title=title,
            message=message,
            threshold=threshold,
            current_value=current_value,
            is_resolved=False,
            created_at=datetime.utcnow(),
        )
        db.add(alert)


async def _resolve_alert_type(db: AsyncSession, node_id: uuid.UUID, alert_type: str):
    """Automatically marks an alert resolved when telemetry returns to normal."""
    q = (
        select(MonitoringAlert)
        .where(MonitoringAlert.node_id == node_id)
        .where(MonitoringAlert.alert_type == alert_type)
        .where(MonitoringAlert.is_resolved == False)
    )
    res = await db.execute(q)
    existing = res.scalar_one_or_none()
    if existing:
        existing.is_resolved = True
        existing.resolved_at = datetime.utcnow()


# ---------------------------------------------------------------------------
# Installer Script Distribution
# ---------------------------------------------------------------------------

@router.get("/install-script")
async def get_install_script(request: Request):
    """
    Returns production curl | bash installer for AYAL Monitoring Agent.
    Usage on nodes:
      curl -fsSL https://<backend-host>/api/agent/install-script | bash
    """
    base_url = str(request.base_url).rstrip("/")
    script_content = f"""#!/usr/bin/env bash
# ==============================================================================
# AYAL HPC Monitoring Agent — Production Zero-Dependency Installer
# Installs Python 3 standalone daemon & systemd unit service
# ==============================================================================
set -e

BACKEND_URL="{base_url}"
INSTALL_DIR="/opt/ayalhpc"
AGENT_SCRIPT="$INSTALL_DIR/ayalhpc-agent.py"
SERVICE_FILE="/etc/systemd/system/ayalhpc-agent.service"

echo ">>> [AYAL HPC] Installing Centralized Live Telemetry Agent..."

mkdir -p "$INSTALL_DIR"
mkdir -p /var/log/ayalhpc

# Download agent daemon
echo ">>> [AYAL HPC] Downloading daemon from $BACKEND_URL/api/agent/daemon-source..."
curl -fsSL "$BACKEND_URL/api/agent/daemon-source" -o "$AGENT_SCRIPT"
chmod +x "$AGENT_SCRIPT"

# Detect hostname and IP
NODE_HOSTNAME=$(hostname -f 2>/dev/null || hostname)
PRIMARY_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{{print $7}}' | head -1)

# Generate Systemd Service
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=AYAL HPC Live Monitoring Agent Daemon
After=network.target network-online.target sshd.service
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/python3 $AGENT_SCRIPT --backend $BACKEND_URL/api --interval 5 --hostname $NODE_HOSTNAME --ip $PRIMARY_IP
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

echo ">>> [AYAL HPC] Reloading systemd and enabling service..."
systemctl daemon-reload
systemctl enable ayalhpc-agent.service
systemctl restart ayalhpc-agent.service

echo ">>> [AYAL HPC] Agent successfully installed and active!"
systemctl status ayalhpc-agent.service --no-pager -l
"""
    return Response(content=script_content, media_type="text/x-shellscript")


@router.get("/daemon-source")
async def get_daemon_source():
    """Serves the standalone agent Python script directly to client nodes."""
    try:
        with open("scripts/ayalhpc-agent.py", "r", encoding="utf-8") as f:
            code = f.read()
        return Response(content=code, media_type="text/x-python")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read agent daemon script: {str(e)}")
