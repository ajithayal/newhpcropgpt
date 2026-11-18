"""
AjiCorehpc Manager — Storage & NFS Management API
Endpoints for:
1. Storage Overview Dashboard & Telemetry
2. Storage Volumes & Filesystem Inspection
3. Client Node NFS Mount Status
4. Agent-Based 5-Step NFS Configuration Wizard
5. Storage Settings & Defaults
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, AuditLog, Node
from app.services.storage_service import StorageService
from app.core.security_crypto import decrypt_secret
from sqlalchemy import select

router = APIRouter(prefix="/storage", tags=["storage"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TestNfsConnectionRequest(BaseModel):
    server_ip: str = Field(..., description="IP address or FQDN of NFS Server")
    ssh_user: str = Field("root", description="SSH username")
    ssh_password: Optional[str] = Field(None, description="SSH Password")
    private_key: Optional[str] = Field(None, description="SSH Private Key")
    port: Optional[int] = Field(22, description="SSH Port")


class DiscoverStorageRequest(BaseModel):
    server_ip: str = Field(..., description="IP address or FQDN of Server")
    ssh_user: Optional[str] = "root"
    ssh_password: Optional[str] = None


class ExportConfigItem(BaseModel):
    path: str
    allowed_clients: Optional[str] = "*"
    access: Optional[str] = "rw"
    root_squash: Optional[str] = "no_root_squash"
    sync_mode: Optional[str] = "sync"
    extra_options: Optional[str] = "no_subtree_check"


class ConfigureExportsRequest(BaseModel):
    server_ip: str = Field(..., description="NFS Server IP")
    exports: List[ExportConfigItem]
    ssh_user: Optional[str] = "root"
    ssh_password: Optional[str] = None


class ClientMountItem(BaseModel):
    path: str
    mount_point: Optional[str] = None
    mount_options: Optional[str] = "vers=3,soft,timeo=30,_netdev"


class ClientNodeTarget(BaseModel):
    hostname: str
    ip: str


class ConfigureClientsRequest(BaseModel):
    server_ip: str = Field(..., description="NFS Server IP")
    exports_to_mount: List[ClientMountItem]
    client_nodes: List[ClientNodeTarget]
    ssh_user: Optional[str] = "root"
    ssh_password: Optional[str] = None


class DeleteNfsExportRequest(BaseModel):
    server_ip: Optional[str] = None
    path: str = Field(..., description="Export path to delete, e.g. /apps")
    ssh_user: Optional[str] = "root"
    ssh_password: Optional[str] = None


class BatchDeleteNfsExportsRequest(BaseModel):
    server_ip: Optional[str] = None
    paths: List[str] = Field(..., description="List of export paths to delete or '*' for all")
    ssh_user: Optional[str] = "root"
    ssh_password: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/discover/{node_id}")
async def discover_node_storage(
    node_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Discover storage details on a specific node via SSH.

    Returns raw command results and parsed disks/partitions.
    """
    try:
        result = await StorageService.discover_node_storage(db, node_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def get_storage_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve real-time storage overview metrics across all cluster nodes."""
    return await StorageService.get_storage_overview(db, current_user.tenant_id)


@router.get("")
async def get_storage_mounts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List storage mounts (compatibility endpoint for existing storage view)."""
    data = await StorageService.get_storage_overview(db, current_user.tenant_id)
    # Extract flat list of mounts
    all_mounts = []
    for node in data.get("nodes_utilization", []):
        for m in node.get("mounts", []):
            all_mounts.append({
                "id": f"{node['hostname']}-{m['mount_point']}",
                "name": f"{m['mount_point']} on {node['hostname']}",
                "node_hostname": node["hostname"],
                "node_ip": node["ip"],
                "mount_point": m["mount_point"],
                "fs_type": m["filesystem"],
                "total_gb": m["size"],
                "used_gb": m["used"],
                "avail_gb": m["available"],
                "used_pct": m["use_pct"],
                "status": "active" if node["status"] == "online" else "offline",
                "is_nfs_exported": m.get("is_nfs_exported", False),
            })
    return {"mounts": all_mounts, "summary": data.get("summary", {})}


@router.get("/volumes")
async def get_storage_volumes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve physical and logical block devices and volumes across all nodes."""
    n_q = await db.execute(select(Node).where(Node.tenant_id == current_user.tenant_id))
    nodes = n_q.scalars().all()
    all_vols = []
    for node in nodes:
        if node.address:
            try:
                tags = node.tags if isinstance(node.tags, dict) else {}
                u = tags.get("ssh_user") or tags.get("user") or "root"
                p = tags.get("ssh_password") or tags.get("password") or ""
                if p:
                    p = decrypt_secret(p) or p
                vols = await StorageService.discover_nfs_server_storage(
                    server_ip=node.address,
                    user=u,
                    password=p,
                )
                for v in vols:
                    v["node_hostname"] = node.hostname or node.name
                    v["node_ip"] = node.address
                all_vols.extend(vols)
            except Exception:
                # If node is offline/unreachable, skip gracefully
                continue
    return {"volumes": all_vols}


@router.get("/clients")
async def get_client_nodes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve all cluster nodes and their live NFS client mount statuses."""
    overview = await StorageService.get_storage_overview(db, current_user.tenant_id)
    return {
        "client_nodes": overview.get("client_mounts", []),
        "nodes_utilization": overview.get("nodes_utilization", []),
    }


# ---------------------------------------------------------------------------
# NFS Configuration Wizard Endpoints
# ---------------------------------------------------------------------------

@router.post("/nfs/test-connection")
async def test_nfs_connection(
    data: TestNfsConnectionRequest,
    current_user: User = Depends(require_admin),
):
    """Wizard Step 1: Test SSH connectivity, privileges, and NFS packages."""
    return await StorageService.test_nfs_server_connection(
        ip=data.server_ip,
        user=data.ssh_user,
        password=data.ssh_password or StorageService.DEFAULT_SSH_PASS,
        private_key=data.private_key,
        port=data.port or 22,
    )


@router.post("/nfs/discover")
async def discover_server_storage(
    data: DiscoverStorageRequest,
    current_user: User = Depends(require_admin),
):
    """Wizard Step 2: Discover partitions, mount points, and existing NFS exports."""
    try:
        volumes = await StorageService.discover_nfs_server_storage(
            server_ip=data.server_ip,
            user=data.ssh_user or StorageService.DEFAULT_SSH_USER,
            password=data.ssh_password or StorageService.DEFAULT_SSH_PASS,
        )
        return {"server_ip": data.server_ip, "volumes": volumes, "total": len(volumes)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nfs/configure-exports")
async def configure_nfs_exports(
    data: ConfigureExportsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Wizard Step 3: Configure and activate NFS exports on the server."""
    try:
        exports_data = [e.model_dump() for e in data.exports]
        result = await StorageService.configure_nfs_exports(
            server_ip=data.server_ip,
            exports=exports_data,
            user=data.ssh_user or StorageService.DEFAULT_SSH_USER,
            password=data.ssh_password or StorageService.DEFAULT_SSH_PASS,
            tenant_id=current_user.tenant_id,
        )
        db.add(AuditLog(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            action="nfs_exports_configure",
            resource_type="storage",
            details={"server_ip": data.server_ip, "exports_count": len(data.exports)},
        ))
        await db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nfs/configure-clients")
async def configure_nfs_clients(
    data: ConfigureClientsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Wizard Step 4: Mount NFS exports on selected client nodes and persist in fstab."""
    try:
        exports_data = [e.model_dump() for e in data.exports_to_mount]
        clients_data = [c.model_dump() for c in data.client_nodes]
        result = await StorageService.configure_nfs_clients(
            server_ip=data.server_ip,
            exports_to_mount=exports_data,
            client_nodes=clients_data,
            user=data.ssh_user or StorageService.DEFAULT_SSH_USER,
            password=data.ssh_password or StorageService.DEFAULT_SSH_PASS,
            tenant_id=current_user.tenant_id,
        )
        db.add(AuditLog(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            action="nfs_clients_configure",
            resource_type="storage",
            details={"server_ip": data.server_ip, "nodes_count": len(data.client_nodes)},
        ))
        await db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/nfs/exports")
async def list_nfs_exports(
    server_ip: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all currently active NFS exports from server /etc/exports and database."""
    overview = await StorageService.get_storage_overview(db, current_user.tenant_id)
    return {
        "success": True,
        "nfs_exports": overview.get("nfs_exports", []),
        "server_ip": server_ip or StorageService.DEFAULT_MASTER_IP,
    }


@router.delete("/nfs/exports")
async def delete_nfs_export(
    path: str = Query(..., description="Export path to permanently delete, e.g. /apps"),
    server_ip: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Permanently delete an individual exported NFS share configuration.
    CRITICAL: Does NOT delete underlying directory or files on disk.
    """
    try:
        result = await StorageService.delete_nfs_exports(
            server_ip=server_ip or StorageService.DEFAULT_MASTER_IP,
            paths_to_delete=[path],
            db=db,
            tenant_id=current_user.tenant_id,
        )
        db.add(AuditLog(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            action="nfs_export_delete",
            resource_type="storage",
            details={"path": path, "server_ip": server_ip},
        ))
        await db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/nfs/exports/batch-delete")
async def batch_delete_nfs_exports(
    data: BatchDeleteNfsExportsRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Permanently delete multiple or all exported NFS share configurations.
    CRITICAL: Does NOT delete underlying directories or files on disk.
    """
    try:
        result = await StorageService.delete_nfs_exports(
            server_ip=data.server_ip or StorageService.DEFAULT_MASTER_IP,
            paths_to_delete=data.paths,
            user=data.ssh_user or StorageService.DEFAULT_SSH_USER,
            password=data.ssh_password or StorageService.DEFAULT_SSH_PASS,
            db=db,
            tenant_id=current_user.tenant_id,
        )
        db.add(AuditLog(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            action="nfs_exports_batch_delete",
            resource_type="storage",
            details={"paths": data.paths, "server_ip": data.server_ip},
        ))
        await db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/settings")
async def get_storage_settings(
    current_user: User = Depends(get_current_user),
):
    """Retrieve storage defaults, protocol versions, and backup retention rules."""
    return {
        "default_nfs_version": "3",
        "default_mount_options": "vers=3,soft,timeo=30,_netdev",
        "allowed_client_cidr": "*",
        "default_backup_path": "/backup",
        "retention_full_backups": 7,
        "retention_incremental_backups": 14,
        "retention_days": 30,
        "bandwidth_limit_mb": 100,
        "quota_enforced_paths": ["/home"],
        "high_usage_warning_threshold_pct": 85,
        "critical_usage_alert_threshold_pct": 95,
    }
