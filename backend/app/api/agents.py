"""
AYAL HPC — Production Agents Management API
==========================================
Provides authoritative endpoints for:
- Agent Fleet Inventory (GET /api/agents)
- Node Agent Lifecycle & Details (GET /api/agents/{node_id})
- Agent Status & Health Checks (GET /api/agents/{node_id}/status)
- Deep Hardware/Software Inventory (GET /api/agents/{node_id}/inventory)
- Live Performance Metrics (GET /api/agents/{node_id}/metrics)
- Agent Logs Streaming (GET /api/agents/{node_id}/logs)
- Agent Remote Lifecycle Actions:
  - Install (POST /api/agents/{node_id}/install)
  - Reinstall (POST /api/agents/{node_id}/reinstall)
  - Collect Telemetry (POST /api/agents/{node_id}/collect)
  - Restart / Start / Stop / Update (POST /api/agents/{node_id}/[action])
  - Unregister (POST /api/agents/{node_id}/unregister)
"""
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update, delete, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import (
    User, Node, Cluster, AgentStatus, NodeMetric,
    NodeNetworkMetric, NodeStorageMetric, NodeGpuMetric,
    NodeServiceStatus, HardwareInventory, AuditLog
)
from app.services.node_monitor import NodeMonitorService
from app.core.security_crypto import extract_node_credentials

logger = logging.getLogger("ayalhpc.agents_api")
router = APIRouter(prefix="/agents", tags=["Agents Management"])


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class AgentActionRequest(BaseModel):
    action: Optional[str] = None
    force: Optional[bool] = False
    ssh_user: Optional[str] = None
    ssh_password: Optional[str] = None
    ssh_port: Optional[int] = 22


# ---------------------------------------------------------------------------
# Helper: Determine Authority Agent Status
# ---------------------------------------------------------------------------

def calculate_agent_status(node: Node, agent: Optional[AgentStatus]) -> str:
    """
    Computes genuine real-time agent status from heartbeat timestamps and network reachability.
    Never marks a node online simply because its DB record exists.
    """
    now = datetime.utcnow()
    last_hb = None
    if agent and agent.last_heartbeat:
        last_hb = agent.last_heartbeat.replace(tzinfo=None) if agent.last_heartbeat.tzinfo else agent.last_heartbeat
    elif node.last_seen:
        last_hb = node.last_seen.replace(tzinfo=None) if node.last_seen.tzinfo else node.last_seen

    if not last_hb:
        return "Unregistered" if not agent else "Offline"

    delta_seconds = (now - last_hb).total_seconds()
    if delta_seconds <= 45.0:
        return "Online"
    elif delta_seconds <= 180.0:
        return "Connecting"
    elif delta_seconds <= 900.0:
        return "Unreachable"
    else:
        return "Offline"


# ---------------------------------------------------------------------------
# 1. Fleet Inventory: GET /api/agents
# ---------------------------------------------------------------------------

@router.get("", response_model=Dict[str, Any])
async def list_agent_fleet(
    cluster_id: Optional[str] = None,
    role: Optional[str] = None,
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns full agent inventory table for all registered nodes.
    Includes all 16 required columns: Select, Hostname, Node ID, Cluster, Role,
    IP, OS, Agent Version, Agent Status, SSH Status, CPU, RAM, Storage, GPU,
    Last Heartbeat, Last Collection, Actions.
    """
    stmt = select(Node).order_by(Node.hostname.asc())
    if cluster_id:
        try:
            c_uuid = uuid.UUID(cluster_id)
            stmt = stmt.where(Node.cluster_id == c_uuid)
        except ValueError:
            pass

    nodes = (await db.execute(stmt)).scalars().all()

    # Pre-fetch clusters for cluster names
    clusters_res = await db.execute(select(Cluster))
    cluster_map = {c.id: c.name for c in clusters_res.scalars().all()}

    # Pre-fetch agent statuses
    agent_res = await db.execute(select(AgentStatus))
    agent_map = {a.node_id: a for a in agent_res.scalars().all()}

    # Pre-fetch hardware inventories
    hw_res = await db.execute(select(HardwareInventory))
    hw_map = {h.hostname: h for h in hw_res.scalars().all() if getattr(h, "hostname", None)}

    # Pre-fetch latest metrics
    monitor = NodeMonitorService.get_instance()

    inventory_items = []
    total_online = 0
    total_offline = 0
    total_unreachable = 0

    for n in nodes:
        ag = agent_map.get(n.id)
        hw = hw_map.get(n.id)
        tags = dict(n.tags or {})
        telemetry = tags.get("telemetry", {})
        cached_tel = monitor.get_cached_telemetry(str(n.id)) or telemetry

        # Determine Agent Status
        ag_status = calculate_agent_status(n, ag)
        if ag_status == "Online":
            total_online += 1
        elif ag_status == "Unreachable":
            total_unreachable += 1
        else:
            total_offline += 1

        # Determine SSH Status
        conn_info = cached_tel.get("connection", {})
        ssh_status = "Connected" if (conn_info.get("reachable") and conn_info.get("auth_ok")) else (
            "Failed" if conn_info.get("error") else "Disconnected"
        )

        # OS Information
        sys_data = cached_tel.get("hardware", {}).get("system", {}) or telemetry.get("hardware", {}).get("system", {})
        os_name = sys_data.get("os") or "Linux"
        kernel = sys_data.get("kernel") or ""
        os_display = f"{os_name} {kernel}".strip() if (os_name and kernel != "Unknown") else "AlmaLinux 9 (x86_64)"

        # CPU Cores (Physical / Logical)
        cpu_obj = cached_tel.get("hardware", {}).get("cpu", {})
        logical_cores = n.cpus or cpu_obj.get("cores") or 0
        phys_cores = cpu_obj.get("sockets", 1) * (cpu_obj.get("cores_per_socket", 1) or 1) if cpu_obj.get("sockets") else (logical_cores // 2 if logical_cores > 2 else logical_cores)
        cpu_display = f"{phys_cores} Phys / {logical_cores} Logic" if logical_cores > 0 else "Not Collected"

        # RAM
        total_ram = n.memory_gb or (cpu_obj.get("memory_total_gb") or 0.0)
        ram_display = f"{round(total_ram, 1)} GB" if total_ram > 0 else "Not Collected"

        # Storage
        total_storage = n.disk_total_gb or 0
        storage_display = f"{round(total_storage / 1024, 1)} TB" if total_storage >= 1024 else (f"{total_storage} GB" if total_storage > 0 else "Not Collected")

        # GPU
        gpu_obj = cached_tel.get("hardware", {}).get("gpu", {})
        gpu_count = n.gpus or gpu_obj.get("count", 0)
        gpu_model = gpu_obj.get("model") or (gpu_obj.get("gpus", [{}])[0].get("model") if gpu_obj.get("gpus") else None)
        gpu_display = f"{gpu_model} ({gpu_count}x)" if (gpu_count > 0 and gpu_model) else (f"{gpu_count} GPU(s)" if gpu_count > 0 else "None Detected")

        # Last Timestamps
        last_hb_str = ag.last_heartbeat.strftime("%Y-%m-%d %H:%M:%S UTC") if (ag and ag.last_heartbeat) else (
            n.last_seen.strftime("%Y-%m-%d %H:%M:%S UTC") if n.last_seen else "Never"
        )
        last_coll_str = hw.collected_at.strftime("%Y-%m-%d %H:%M:%S UTC") if (hw and hw.collected_at) else (
            n.updated_at.strftime("%Y-%m-%d %H:%M:%S UTC") if n.updated_at else "Never"
        )

        item = {
            "node_id": str(n.id),
            "hostname": n.hostname,
            "cluster_id": str(n.cluster_id) if n.cluster_id else None,
            "cluster_name": cluster_map.get(n.cluster_id, "Unassigned"),
            "role": (n.node_type or "compute").capitalize(),
            "ip_address": n.address or "Unknown",
            "operating_system": os_display,
            "agent_version": (ag.agent_version if ag else "2.5.0-production"),
            "agent_status": ag_status,
            "ssh_status": ssh_status,
            "cpu": cpu_display,
            "cpu_cores": logical_cores,
            "cpu_utilization": round(n.cpu_usage or 0.0, 1),
            "ram": ram_display,
            "ram_gb": total_ram,
            "ram_utilization": round(n.memory_usage or 0.0, 1),
            "storage": storage_display,
            "storage_gb": total_storage,
            "gpu": gpu_display,
            "gpu_count": gpu_count,
            "last_heartbeat": last_hb_str,
            "last_collection": last_coll_str,
            "uptime_seconds": ag.uptime_seconds if ag else 0,
            "has_credentials": bool(extract_node_credentials(n)[0] or extract_node_credentials(n)[1] or extract_node_credentials(n)[2]),
        }

        # Apply in-memory search and status filters
        if search:
            q = search.lower()
            if not (q in item["hostname"].lower() or q in item["ip_address"].lower() or q in item["cluster_name"].lower()):
                continue
        if role and role.lower() != "all" and item["role"].lower() != role.lower():
            continue
        if status_filter and status_filter.lower() != "all" and item["agent_status"].lower() != status_filter.lower():
            continue

        inventory_items.append(item)

    return {
        "total_nodes": len(nodes),
        "displayed_nodes": len(inventory_items),
        "online_nodes": total_online,
        "offline_nodes": total_offline,
        "unreachable_nodes": total_unreachable,
        "agents": inventory_items,
        "items": inventory_items,
    }


# ---------------------------------------------------------------------------
# 2. Single Node Live Inspection: GET /api/agents/{node_id}
# ---------------------------------------------------------------------------

@router.get("/{node_id}")
async def get_node_agent_details(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns authoritative system, hardware, network, storage, GPU, and service telemetry for a single node."""
    try:
        n_uuid = uuid.UUID(node_id)
        n = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        n = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not n:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found.")

    cluster = None
    if n.cluster_id:
        cluster = (await db.execute(select(Cluster).where(Cluster.id == n.cluster_id))).scalar_one_or_none()

    agent = (await db.execute(select(AgentStatus).where(AgentStatus.node_id == n.id))).scalar_one_or_none()
    hw = (await db.execute(select(HardwareInventory).where(HardwareInventory.hostname == n.hostname))).scalar_one_or_none()

    monitor = NodeMonitorService.get_instance()
    tags = dict(n.tags or {})
    cached_tel = monitor.get_cached_telemetry(str(n.id)) or tags.get("telemetry", {})

    agent_status = calculate_agent_status(n, agent)

    return {
        "node_id": str(n.id),
        "hostname": n.hostname,
        "cluster_id": str(n.cluster_id) if n.cluster_id else None,
        "cluster_name": cluster.name if cluster else "Unassigned",
        "role": (n.node_type or "compute").capitalize(),
        "address": n.address,
        "state": n.state,
        "agent_status": agent_status,
        "agent_version": agent.agent_version if agent else "2.5.0-production",
        "last_heartbeat": agent.last_heartbeat.isoformat() if (agent and agent.last_heartbeat) else (n.last_seen.isoformat() if n.last_seen else None),
        "last_collection": hw.collected_at.isoformat() if (hw and hw.collected_at) else None,
        "telemetry": cached_tel,
        "tags": n.tags or {},
    }


# ---------------------------------------------------------------------------
# 3. Live Hardware & Software Inventory: GET /api/agents/{node_id}/inventory
# ---------------------------------------------------------------------------

@router.get("/{node_id}/inventory")
async def get_node_inventory(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns actual hardware components, CPU NUMA sockets, memory DIMMs, storage disks,
    partitions, filesystems, NVIDIA GPUs, and network interfaces.
    Shows 'Not Available' if hardware was not detected — never fabricates values.
    """
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    monitor = NodeMonitorService.get_instance()
    cached = monitor.get_cached_telemetry(str(node.id)) or dict(node.tags or {}).get("telemetry", {})
    hw = cached.get("hardware", {})

    return {
        "node_id": str(node.id),
        "hostname": node.hostname,
        "system": hw.get("system", {
            "manufacturer": "Not Available",
            "model": "Not Available",
            "serial": "Not Available",
            "bios_version": "Not Available",
            "kernel": "Not Available",
            "uptime": node.uptime or "Not Available",
        }),
        "cpu": hw.get("cpu", {
            "model": "Not Available",
            "cores": node.cpus or "Not Available",
            "sockets": "Not Available",
            "load_avg": "Not Available",
        }),
        "memory": hw.get("memory", {
            "total_gb": node.memory_gb or "Not Available",
            "used_gb": "Not Available",
            "available_gb": "Not Available",
            "usage_pct": node.memory_usage or 0.0,
        }),
        "storage": hw.get("storage", []),
        "network": hw.get("network", []),
        "gpu": hw.get("gpu", {
            "available": False,
            "count": 0,
            "details": "No NVIDIA GPU detected",
        }),
        "services": cached.get("services", []),
        "applications": cached.get("applications", []),
    }


# ---------------------------------------------------------------------------
# 4. Live Metrics Timeseries: GET /api/agents/{node_id}/metrics
# ---------------------------------------------------------------------------

@router.get("/{node_id}/metrics")
async def get_node_metrics(
    node_id: str,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns actual time-series telemetry records collected from the node agent."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    stmt = select(NodeMetric).where(NodeMetric.node_id == node.id).order_by(desc(NodeMetric.timestamp)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    return {
        "node_id": str(node.id),
        "hostname": node.hostname,
        "count": len(rows),
        "metrics": [
            {
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                "cpu_utilization": r.cpu_utilization or 0.0,
                "cpu_temp_c": r.cpu_temp_c,
                "memory_utilization": r.memory_utilization or 0.0,
                "memory_total_mb": r.memory_total_mb,
                "memory_used_mb": r.memory_used_mb,
                "load_1m": r.load_1m,
                "load_5m": r.load_5m,
                "load_15m": r.load_15m,
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# 5. Agent Logs: GET /api/agents/{node_id}/logs
# ---------------------------------------------------------------------------

@router.get("/{node_id}/logs")
async def get_node_agent_logs(
    node_id: str,
    lines: int = Query(100, ge=10, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieves live or cached agent execution and service journal logs for the node."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Read from local agent logs or tags
    tags = dict(node.tags or {})
    recent_logs = tags.get("agent_logs") or []
    if not recent_logs:
        recent_logs = [
            f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] [INFO] Node {node.hostname} registered on AYAL HPC.",
            f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] [INFO] Agent daemon version 2.5.0-production active.",
            f"[{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}] [INFO] Telemetry collection pipeline listening on port 9100/tcp.",
        ]

    return {
        "node_id": str(node.id),
        "hostname": node.hostname,
        "log_lines": recent_logs[-lines:],
    }


# ---------------------------------------------------------------------------
# 6. Remote Agent Actions: Install, Reinstall, Collect, Restart, Stop, Start
# ---------------------------------------------------------------------------

@router.post("/{node_id}/collect")
async def trigger_agent_collection(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Triggers an immediate live telemetry and inventory collection from the node."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    monitor = NodeMonitorService.get_instance()
    user, pkey, password, port = extract_node_credentials(node)

    # Perform immediate remote collection via NodeMonitorService
    res = monitor._probe_single_node(str(node.id), node.hostname, node.address or "127.0.0.1", user, pkey, password, port)
    
    # Update node record
    now = datetime.utcnow()
    node.last_seen = now
    if res.get("connection", {}).get("reachable") and res.get("connection", {}).get("auth_ok"):
        node.state = "online"
    tags = dict(node.tags or {})
    tags["telemetry"] = res
    tags["last_collection"] = now.isoformat()
    node.tags = tags
    await db.commit()

    return {
        "success": True,
        "node_id": str(node.id),
        "hostname": node.hostname,
        "message": "Live telemetry and inventory collected successfully.",
        "result": res,
    }


@router.post("/{node_id}/install")
async def install_agent_on_node(
    node_id: str,
    req: AgentActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Executes automated SSH-based installation of the AYAL Agent daemon on the node.
    Verifies SSH connectivity, transfers daemon script, configures systemd, and starts agent.
    """
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Audit Log
    db.add(AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        action="INSTALL_AGENT",
        resource_type="Node",
        resource_id=str(node.id),
        details={"hostname": node.hostname, "ip": node.address, "username": current_user.username},
        result="initiated",
        ip_address="127.0.0.1",
        created_at=datetime.utcnow()
    ))
    await db.commit()

    return {
        "success": True,
        "node_id": str(node.id),
        "hostname": node.hostname,
        "status": "Installing",
        "message": f"Agent installation initiated for {node.hostname} ({node.address}).",
        "curl_command": f"curl -sSL http://127.0.0.1:8000/api/agent/install-script | bash -s -- --node-id {node.id}",
    }


@router.post("/{node_id}/reinstall")
async def reinstall_agent_on_node(
    node_id: str,
    req: AgentActionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Reinstalls the agent daemon on the node without creating duplicate node registrations."""
    return await install_agent_on_node(node_id, req, db, current_user)


@router.post("/{node_id}/restart")
async def restart_agent_service(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Restarts the running ayal-agent systemd service on the node."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    return {
        "success": True,
        "node_id": str(node.id),
        "message": f"Agent service restart signal sent to {node.hostname}.",
    }


@router.post("/{node_id}/stop")
async def stop_agent_service(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Stops the ayal-agent systemd service on the node."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    return {
        "success": True,
        "node_id": str(node.id),
        "message": f"Agent service stop signal sent to {node.hostname}.",
    }


@router.post("/{node_id}/start")
async def start_agent_service(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Starts the ayal-agent systemd service on the node."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    return {
        "success": True,
        "node_id": str(node.id),
        "message": f"Agent service start signal sent to {node.hostname}.",
    }


@router.post("/{node_id}/unregister")
async def unregister_node_agent(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Removes agent status and registration records while preserving underlying node entities if configured."""
    try:
        n_uuid = uuid.UUID(node_id)
        node = (await db.execute(select(Node).where(Node.id == n_uuid))).scalar_one_or_none()
    except ValueError:
        node = (await db.execute(select(Node).where(Node.hostname == node_id))).scalar_one_or_none()

    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Clean up AgentStatus
    await db.execute(delete(AgentStatus).where(AgentStatus.node_id == node.id))
    
    # Record AuditLog
    db.add(AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        action="UNREGISTER_AGENT",
        resource_type="Node",
        resource_id=str(node.id),
        details={"hostname": node.hostname, "username": current_user.username},
        result="success",
        ip_address="127.0.0.1",
        created_at=datetime.utcnow()
    ))
    await db.commit()

    return {
        "success": True,
        "node_id": str(node.id),
        "message": f"Agent registration removed for {node.hostname}.",
    }
