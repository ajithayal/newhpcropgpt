"""
AjiCorehpc Manager — Enterprise Backup, Chain Management & Restore API
Endpoints for:
1. Backup Storage Repositories
2. Backup Jobs & Multi-Step Configuration
3. Full & Incremental Execution Engine
4. Recovery Points & Manifest Inspection
5. Point-in-Time Restore Wizard
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
import uuid

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, AuditLog
from app.services.backup_service import BackupService

router = APIRouter(prefix="/backups", tags=["backups"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateRepositoryRequest(BaseModel):
    name: str = Field(..., description="Repository name")
    path: str = Field("/backup", description="Storage path on server")
    server_ip: Optional[str] = None
    repo_type: Optional[str] = "local"
    protocol: Optional[str] = "local"
    encryption_enabled: Optional[bool] = False


class CreateBackupJobRequest(BaseModel):
    name: str = Field(..., description="Job identifier")
    source_node_ip: Optional[str] = None
    source_directories: List[str] = Field(["/home"], description="Directories to back up")
    include_patterns: Optional[List[str]] = ["*"]
    exclude_patterns: Optional[List[str]] = [".cache", "tmp", "*.log"]
    repo_id: Optional[str] = None
    backup_type: Optional[str] = "incremental"  # full, incremental, differential
    schedule_cron: Optional[str] = "0 2 * * *"
    is_active: Optional[bool] = True
    retention_full_count: Optional[int] = 7
    retention_inc_count: Optional[int] = 14
    retention_days: Optional[int] = 30
    bandwidth_limit_mb: Optional[int] = 100


class RestoreWizardRequest(BaseModel):
    recovery_point_id: str
    target_node_ip: Optional[str] = None
    target_directory: str
    specific_subpath: Optional[str] = None
    overwrite: Optional[bool] = False


# ---------------------------------------------------------------------------
# Repositories Endpoints
# ---------------------------------------------------------------------------

@router.get("/repositories")
async def list_repositories(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List backup storage repositories with live disk metrics."""
    return await BackupService.get_repositories(db, current_user.tenant_id)


@router.post("/repositories")
async def create_repository(
    data: CreateRepositoryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create or register a backup repository."""
    try:
        return await BackupService.create_repository(db, data.model_dump(), current_user.tenant_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Backup Jobs Endpoints
# ---------------------------------------------------------------------------

@router.get("/jobs")
async def list_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all scheduled and manual backup jobs."""
    return await BackupService.get_jobs(db, current_user.tenant_id)


@router.post("/jobs")
async def create_job(
    data: CreateBackupJobRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new backup job with schedule and retention policies."""
    try:
        return await BackupService.create_job(db, data.model_dump(), current_user.tenant_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/jobs/{job_id}/run")
async def run_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Execute a backup job immediately (Full or Incremental)."""
    try:
        j_uuid = uuid.UUID(job_id)
        result = await BackupService.run_backup_job(db, j_uuid)
        db.add(AuditLog(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            action="backup_execute",
            resource_type="backup",
            details={"job_id": job_id, "snapshot_id": result.get("snapshot_id"), "type": result.get("backup_type")},
        ))
        await db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/jobs/{job_id}")
async def update_job(
    job_id: str,
    data: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update backup job parameters, directories, schedule, or retention."""
    try:
        j_uuid = uuid.UUID(job_id)
        return await BackupService.update_job(db, j_uuid, data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete a backup job configuration."""
    try:
        j_uuid = uuid.UUID(job_id)
        success = await BackupService.delete_job(db, j_uuid)
        if not success:
            raise HTTPException(status_code=404, detail="Job not found")
        db.add(AuditLog(
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            action="backup_job_delete",
            resource_type="backup",
            details={"job_id": job_id},
        ))
        await db.commit()
        return {"success": True, "message": "Job deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/jobs/{job_id}/pause")
async def toggle_pause_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Pause or resume a scheduled backup job."""
    try:
        j_uuid = uuid.UUID(job_id)
        return await BackupService.toggle_job_pause(db, j_uuid)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Recovery Points & History
# ---------------------------------------------------------------------------

@router.get("/history")
async def get_backup_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List recovery points, chain IDs, deduplication ratios, and status."""
    return await BackupService.get_history(db, current_user.tenant_id)


# Compatibility endpoints for older BackupPage
@router.get("")
async def list_backups_compat(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Compatibility listing for existing backup page."""
    history = await BackupService.get_history(db, current_user.tenant_id)
    items = []
    for h in history:
        items.append({
            "filename": h["snapshot_id"],
            "size_bytes": int(h["total_size_mb"] * 1024 * 1024),
            "created_at": h["completed_at"] or h["started_at"] or "",
            "backup_type": h["backup_type"],
            "status": h["status"],
            "repo_path": h["repo_path"],
        })
    return {"backups": items, "total": len(items)}


@router.post("/create")
async def create_backup_compat(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Compatibility trigger to run standard backup job."""
    jobs = await BackupService.get_jobs(db, current_user.tenant_id)
    if not jobs:
        # Create default job
        created = await BackupService.create_job(db, {"name": "Default Cluster Workspace Backup"}, current_user.tenant_id)
        target_id = created["id"]
    else:
        target_id = jobs[0]["id"]
    result = await BackupService.run_backup_job(db, uuid.UUID(target_id))
    return {"status": "ok", "message": result.get("message", "Backup completed successfully")}


# ---------------------------------------------------------------------------
# Restore Wizard Endpoints
# ---------------------------------------------------------------------------

@router.post("/restore")
async def restore_backup(
    data: RestoreWizardRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Restore a recovery point to original or alternate destination path."""
    try:
        rp_uuid = uuid.UUID(data.recovery_point_id)
        result = await BackupService.restore_recovery_point(
            db=db,
            recovery_point_id=rp_uuid,
            target_node_ip=data.target_node_ip or "127.0.0.1",
            target_directory=data.target_directory,
            specific_subpath=data.specific_subpath,
            overwrite=data.overwrite or False,
        )
        if result.get("success"):
            db.add(AuditLog(
                user_id=current_user.id,
                tenant_id=current_user.tenant_id,
                action="backup_restore",
                resource_type="backup",
                details={"recovery_point_id": data.recovery_point_id, "restored_to": data.target_directory},
            ))
            await db.commit()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
