"""
AjiCorehpc Manager — Enterprise Backup, Chain Management & Restore Engine
Implements full and incremental backup chains using hardlink deduplication (--link-dest),
manifest verification, safe retention rotation, and point-in-time restore workflows.
"""
import os
import time
import json
import uuid
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, desc

from app.models.models import BackupRepository, BackupJob, BackupRecoveryPoint
from app.services.storage_service import StorageService

logger = logging.getLogger("backup_service")


class BackupService:
    DEFAULT_REPO_PATH = "/backup"
    DEFAULT_MASTER_IP = ""

    # ---------------------------------------------------------------------------
    # Repositories Management
    # ---------------------------------------------------------------------------

    @classmethod
    async def get_repositories(cls, db: AsyncSession, tenant_id: Optional[Any] = None) -> List[Dict[str, Any]]:
        """Lists backup repositories and their real-time disk capacity."""
        # Query DB
        stmt = select(BackupRepository)
        if tenant_id:
            stmt = stmt.where(BackupRepository.tenant_id == tenant_id)
        result = await db.execute(stmt)
        repos = result.scalars().all()

        # If none exist, seed default cluster repo
        if not repos:
            default_repo = BackupRepository(
                name="Primary Cluster Storage Repository",
                repo_type="local",
                server_ip=cls.DEFAULT_MASTER_IP,
                path=cls.DEFAULT_REPO_PATH,
                protocol="local",
                total_bytes=70 * 1024 * 1024 * 1024,
                used_bytes=7 * 1024 * 1024 * 1024,
                encryption_enabled=False,
                status="healthy",
                tenant_id=tenant_id,
            )
            db.add(default_repo)
            await db.commit()
            await db.refresh(default_repo)
            repos = [default_repo]

        # Inspect real capacity on node
        output = []
        for r in repos:
            cmd = f"df -k {r.path} 2>/dev/null || df -k /"
            code, df_out, _ = StorageService.execute_command(r.server_ip, cmd)
            total_k = 0
            used_k = 0
            avail_k = 0
            pct_s = "0%"
            lines = df_out.strip().split("\n")
            if len(lines) > 1:
                tokens = lines[-1].split()
                if len(tokens) >= 5:
                    total_k = int(tokens[1]) if tokens[1].isdigit() else 0
                    used_k = int(tokens[2]) if tokens[2].isdigit() else 0
                    avail_k = int(tokens[3]) if tokens[3].isdigit() else 0
                    pct_s = tokens[4]

            # Count recovery points
            rp_res = await db.execute(select(BackupRecoveryPoint).where(BackupRecoveryPoint.job_id.in_(
                select(BackupJob.id).where(BackupJob.repo_id == r.id)
            )))
            rp_count = len(rp_res.scalars().all())

            output.append({
                "id": str(r.id),
                "name": r.name,
                "server_ip": r.server_ip,
                "path": r.path,
                "protocol": r.protocol,
                "total_gb": round(total_k / (1024 * 1024), 1),
                "used_gb": round(used_k / (1024 * 1024), 1),
                "available_gb": round(avail_k / (1024 * 1024), 1),
                "usage_pct": pct_s,
                "status": "Healthy" if code == 0 else "Degraded",
                "recovery_points_count": rp_count,
                "encryption_enabled": r.encryption_enabled,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            })
        return output

    @classmethod
    async def create_repository(cls, db: AsyncSession, payload: Dict[str, Any], tenant_id: Optional[Any] = None) -> Dict[str, Any]:
        server_ip = payload.get("server_ip", cls.DEFAULT_MASTER_IP)
        repo_path = payload.get("path", "/backup").strip()

        # Validate on server
        code, _, err = StorageService.execute_command(server_ip, f"mkdir -p {repo_path} && chmod 0750 {repo_path}")
        if code != 0:
            raise RuntimeError(f"Failed to create repository directory on {server_ip}: {err}")

        repo = BackupRepository(
            name=payload.get("name", "Custom Backup Repository"),
            repo_type=payload.get("repo_type", "local"),
            server_ip=server_ip,
            path=repo_path,
            protocol=payload.get("protocol", "local"),
            encryption_enabled=payload.get("encryption_enabled", False),
            status="healthy",
            tenant_id=tenant_id,
        )
        db.add(repo)
        await db.commit()
        await db.refresh(repo)
        return {"id": str(repo.id), "name": repo.name, "path": repo.path, "status": repo.status}

    # ---------------------------------------------------------------------------
    # Backup Jobs Management
    # ---------------------------------------------------------------------------

    @classmethod
    async def get_jobs(cls, db: AsyncSession, tenant_id: Optional[Any] = None) -> List[Dict[str, Any]]:
        stmt = select(BackupJob).order_by(desc(BackupJob.created_at))
        if tenant_id:
            stmt = stmt.where(BackupJob.tenant_id == tenant_id)
        result = await db.execute(stmt)
        jobs = result.scalars().all()

        output = []
        for j in jobs:
            # Query recovery points count
            rp_stmt = select(BackupRecoveryPoint).where(BackupRecoveryPoint.job_id == j.id)
            rp_res = await db.execute(rp_stmt)
            rps = rp_res.scalars().all()

            output.append({
                "id": str(j.id),
                "name": j.name,
                "source_node_ip": j.source_node_ip,
                "source_directories": j.source_directories or ["/home"],
                "include_patterns": j.include_patterns or ["*"],
                "exclude_patterns": j.exclude_patterns or [".cache", "tmp", "*.log"],
                "backup_type": j.backup_type,
                "schedule_cron": j.schedule_cron,
                "is_active": j.is_active,
                "retention_full_count": j.retention_full_count,
                "retention_inc_count": j.retention_inc_count,
                "retention_days": j.retention_days,
                "status": j.status,
                "recovery_points_count": len(rps),
                "last_run": j.last_run.isoformat() if j.last_run else None,
                "next_run": j.next_run.isoformat() if j.next_run else None,
                "created_at": j.created_at.isoformat() if j.created_at else "",
            })
        return output

    @classmethod
    async def create_job(cls, db: AsyncSession, payload: Dict[str, Any], tenant_id: Optional[Any] = None) -> Dict[str, Any]:
        # Resolve repo
        repo_id = payload.get("repo_id")
        if not repo_id:
            repos = await cls.get_repositories(db, tenant_id)
            repo_id = uuid.UUID(repos[0]["id"]) if repos else None
        else:
            repo_id = uuid.UUID(repo_id) if isinstance(repo_id, str) else repo_id

        dirs = payload.get("source_directories") or ["/home"]
        if isinstance(dirs, str):
            dirs = [d.strip() for d in dirs.split(",") if d.strip()]

        job = BackupJob(
            name=payload.get("name", "Daily HPC Workspace Backup"),
            source_node_ip=payload.get("source_node_ip", cls.DEFAULT_MASTER_IP),
            source_directories=dirs,
            include_patterns=payload.get("include_patterns") or ["*"],
            exclude_patterns=payload.get("exclude_patterns") or [".cache", "tmp", "*.tmp"],
            repo_id=repo_id,
            backup_type=payload.get("backup_type", "incremental"),
            schedule_cron=payload.get("schedule_cron", "0 2 * * *"),
            is_active=payload.get("is_active", True),
            retention_full_count=payload.get("retention_full_count", 7),
            retention_inc_count=payload.get("retention_inc_count", 14),
            retention_days=payload.get("retention_days", 30),
            bandwidth_limit_mb=payload.get("bandwidth_limit_mb", 100),
            status="idle",
            tenant_id=tenant_id,
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        return {"id": str(job.id), "name": job.name, "status": job.status}

    @classmethod
    async def update_job(cls, db: AsyncSession, job_id: uuid.UUID, payload: Dict[str, Any]) -> Dict[str, Any]:
        job = await db.get(BackupJob, job_id)
        if not job:
            raise ValueError(f"Backup job {job_id} not found")
        if "name" in payload and payload["name"]: job.name = payload["name"]
        if "source_directories" in payload:
            dirs = payload["source_directories"]
            if isinstance(dirs, str): dirs = [d.strip() for d in dirs.split(",") if d.strip()]
            job.source_directories = dirs
        if "backup_type" in payload and payload["backup_type"]: job.backup_type = payload["backup_type"]
        if "schedule_cron" in payload and payload["schedule_cron"]: job.schedule_cron = payload["schedule_cron"]
        if "retention_full_count" in payload and payload["retention_full_count"] is not None: job.retention_full_count = payload["retention_full_count"]
        if "retention_inc_count" in payload and payload["retention_inc_count"] is not None: job.retention_inc_count = payload["retention_inc_count"]
        if "retention_days" in payload and payload["retention_days"] is not None: job.retention_days = payload["retention_days"]
        if "is_active" in payload and payload["is_active"] is not None: job.is_active = payload["is_active"]
        await db.commit()
        return {"id": str(job.id), "name": job.name, "status": job.status, "is_active": job.is_active}

    @classmethod
    async def delete_job(cls, db: AsyncSession, job_id: uuid.UUID) -> bool:
        job = await db.get(BackupJob, job_id)
        if not job:
            return False
        await db.delete(job)
        await db.commit()
        return True

    @classmethod
    async def toggle_job_pause(cls, db: AsyncSession, job_id: uuid.UUID) -> Dict[str, Any]:
        job = await db.get(BackupJob, job_id)
        if not job:
            raise ValueError(f"Backup job {job_id} not found")
        job.is_active = not job.is_active
        job.status = "paused" if not job.is_active else "idle"
        await db.commit()
        return {"id": str(job.id), "is_active": job.is_active, "status": job.status}

    # ---------------------------------------------------------------------------
    # Backup Execution Engine (Full & Incremental)
    # ---------------------------------------------------------------------------

    @classmethod
    async def run_backup_job(cls, db: AsyncSession, job_id: uuid.UUID) -> Dict[str, Any]:
        """Executes a real full or incremental backup using rsync and hardlink chains."""
        job = await db.get(BackupJob, job_id)
        if not job:
            raise ValueError(f"Backup job {job_id} not found")

        repo = await db.get(BackupRepository, job.repo_id) if job.repo_id else None
        repo_base = repo.path if repo else cls.DEFAULT_REPO_PATH
        server_ip = repo.server_ip if repo else cls.DEFAULT_MASTER_IP

        # Update job status
        job.status = "running"
        await db.commit()

        start_time = datetime.utcnow()
        timestamp_str = start_time.strftime("%Y%m%d_%H%M%S")
        snapshot_id = f"snap_{timestamp_str}"

        # 1. Determine if this should be a Full or Incremental backup
        # Check previous recovery points
        rp_stmt = select(BackupRecoveryPoint).where(
            BackupRecoveryPoint.job_id == job.id,
            BackupRecoveryPoint.status == "completed"
        ).order_by(desc(BackupRecoveryPoint.completed_at))
        rp_res = await db.execute(rp_stmt)
        last_rp = rp_res.scalars().first()

        is_full = True
        parent_rp = None
        chain_id = str(uuid.uuid4())[:8]

        if job.backup_type == "incremental" and last_rp:
            # Check if parent snapshot directory exists
            parent_check_code, _, _ = StorageService.execute_command(
                server_ip, f"test -d {last_rp.repo_path}"
            )
            if parent_check_code == 0:
                is_full = False
                parent_rp = last_rp
                chain_id = last_rp.chain_id or chain_id

        btype = "full" if is_full else "incremental"
        dest_dir = f"{repo_base}/{str(job.id)}/{snapshot_id}_{btype}"

        # Ensure repo directories exist
        StorageService.execute_command(server_ip, f"mkdir -p {dest_dir}")

        # 2. Build rsync command
        # Sources
        sources_str = " ".join(job.source_directories or ["/home"])
        excludes_str = " ".join([f"--exclude='{e}'" for e in (job.exclude_patterns or [])])

        link_dest_opt = ""
        if not is_full and parent_rp:
            link_dest_opt = f"--link-dest={parent_rp.repo_path}"

        rsync_cmd = (
            f"rsync -avz --stats --delete {link_dest_opt} {excludes_str} "
            f"{sources_str} {dest_dir}/"
        )

        logger.info(f"Executing backup command on {server_ip}: {rsync_cmd}")
        t0 = time.time()
        code, out, err = StorageService.execute_command(server_ip, rsync_cmd, timeout=300.0)
        duration = round(time.time() - t0, 2)

        # 3. Parse rsync stats
        files_count = 0
        total_size = 0
        transferred_bytes = 0

        for line in out.split("\n"):
            line = line.strip()
            if "Number of files:" in line:
                m = line.split(":")[-1].replace(",", "").split()[0]
                if m.isdigit(): files_count = int(m)
            elif "Total file size:" in line:
                m = line.split(":")[-1].replace(",", "").split()[0]
                if m.isdigit(): total_size = int(m)
            elif "Total transferred file size:" in line:
                m = line.split(":")[-1].replace(",", "").split()[0]
                if m.isdigit(): transferred_bytes = int(m)

        # Compression / deduplication ratio
        dedup_ratio = "1.0x"
        if total_size > 0 and transferred_bytes > 0:
            dedup_ratio = f"{round(total_size / max(1, transferred_bytes), 1)}x"
        elif total_size > 0 and transferred_bytes == 0:
            dedup_ratio = "100% (Hardlinked)"

        status_str = "completed" if code == 0 else "failed"

        # 4. Generate and save manifest.json in the snapshot directory
        manifest = {
            "snapshot_id": snapshot_id,
            "job_id": str(job.id),
            "job_name": job.name,
            "backup_type": btype,
            "chain_id": chain_id,
            "parent_id": str(parent_rp.id) if parent_rp else None,
            "started_at": start_time.isoformat(),
            "completed_at": datetime.utcnow().isoformat(),
            "duration_seconds": duration,
            "source_node": job.source_node_ip,
            "source_directories": job.source_directories,
            "repo_path": dest_dir,
            "file_count": files_count,
            "total_size_bytes": total_size,
            "transferred_bytes": transferred_bytes,
            "deduplication_ratio": dedup_ratio,
            "status": status_str,
        }

        # Write manifest file to disk on server
        import base64
        m_b64 = base64.b64encode(json.dumps(manifest, indent=2).encode('utf-8')).decode('utf-8')
        StorageService.execute_command(server_ip, f"echo '{m_b64}' | base64 -d > {dest_dir}/backup_manifest.json")

        # 5. Record recovery point in database
        rp = BackupRecoveryPoint(
            job_id=job.id,
            chain_id=chain_id,
            parent_id=parent_rp.id if parent_rp else None,
            backup_type=btype,
            snapshot_id=snapshot_id,
            repo_path=dest_dir,
            file_count=files_count,
            total_bytes=total_size,
            transferred_bytes=transferred_bytes,
            compression_ratio=dedup_ratio,
            manifest_json=manifest,
            status=status_str,
            started_at=start_time,
            completed_at=datetime.utcnow(),
            logs=out if code == 0 else f"{out}\nERRORS:\n{err}",
            tenant_id=job.tenant_id,
        )
        db.add(rp)

        # Update Job
        job.status = "idle"
        job.last_run = datetime.utcnow()
        await db.commit()
        await db.refresh(rp)

        # 6. Apply retention and safe rotation
        await cls.rotate_and_cleanup_backups(db, job.id)

        return {
            "success": code == 0,
            "recovery_point_id": str(rp.id),
            "snapshot_id": snapshot_id,
            "backup_type": btype,
            "repo_path": dest_dir,
            "file_count": files_count,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "transferred_mb": round(transferred_bytes / (1024 * 1024), 2),
            "deduplication_ratio": dedup_ratio,
            "duration_seconds": duration,
            "message": f"Backup completed successfully in {duration}s ({btype.upper()}).",
        }

    # ---------------------------------------------------------------------------
    # Retention and Safe Rotation
    # ---------------------------------------------------------------------------

    @classmethod
    async def rotate_and_cleanup_backups(cls, db: AsyncSession, job_id: uuid.UUID):
        """Enforces retention policy without breaking active incremental chains."""
        job = await db.get(BackupJob, job_id)
        if not job:
            return

        stmt = select(BackupRecoveryPoint).where(
            BackupRecoveryPoint.job_id == job_id,
            BackupRecoveryPoint.status == "completed"
        ).order_by(desc(BackupRecoveryPoint.completed_at))
        res = await db.execute(stmt)
        all_rps = res.scalars().all()

        max_full = job.retention_full_count or 7
        max_inc = job.retention_inc_count or 14

        full_rps = [r for r in all_rps if r.backup_type == "full"]
        inc_rps = [r for r in all_rps if r.backup_type == "incremental"]

        # If full backups exceed max_full, identify which ones can be safely deleted
        if len(full_rps) > max_full:
            candidates = full_rps[max_full:]
            for old_full in candidates:
                # CRITICAL: Verify no younger incremental backup depends on this full backup!
                dependents = [i for i in inc_rps if i.parent_id == old_full.id or i.chain_id == old_full.chain_id]
                if not dependents:
                    # Safe to delete from disk and database
                    StorageService.execute_command(cls.DEFAULT_MASTER_IP, f"rm -rf {old_full.repo_path}")
                    await db.delete(old_full)
                    logger.info(f"Rotated out expired full backup {old_full.snapshot_id}")

        await db.commit()

    # ---------------------------------------------------------------------------
    # History & Recovery Points
    # ---------------------------------------------------------------------------

    @classmethod
    async def get_history(cls, db: AsyncSession, tenant_id: Optional[Any] = None) -> List[Dict[str, Any]]:
        stmt = select(BackupRecoveryPoint).order_by(desc(BackupRecoveryPoint.completed_at))
        if tenant_id:
            stmt = stmt.where(BackupRecoveryPoint.tenant_id == tenant_id)
        res = await db.execute(stmt)
        rps = res.scalars().all()

        output = []
        for r in rps:
            output.append({
                "id": str(r.id),
                "job_id": str(r.job_id) if r.job_id else None,
                "snapshot_id": r.snapshot_id,
                "chain_id": r.chain_id,
                "parent_id": str(r.parent_id) if r.parent_id else None,
                "backup_type": r.backup_type,
                "repo_path": r.repo_path,
                "file_count": r.file_count,
                "total_size_mb": round((r.total_bytes or 0) / (1024 * 1024), 2),
                "transferred_mb": round((r.transferred_bytes or 0) / (1024 * 1024), 2),
                "compression_ratio": r.compression_ratio,
                "status": r.status,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "logs": r.logs or "",
            })
        return output

    # ---------------------------------------------------------------------------
    # Restore Workflow
    # ---------------------------------------------------------------------------

    @classmethod
    async def restore_recovery_point(
        cls,
        db: AsyncSession,
        recovery_point_id: uuid.UUID,
        target_node_ip: str,
        target_directory: str,
        specific_subpath: Optional[str] = None,
        overwrite: bool = False,
    ) -> Dict[str, Any]:
        """Restores files from a specific recovery point to original or alternate location."""
        rp = await db.get(BackupRecoveryPoint, recovery_point_id)
        if not rp:
            raise ValueError("Recovery point not found")

        source_path = rp.repo_path
        if specific_subpath:
            source_path = f"{rp.repo_path.rstrip('/')}/{specific_subpath.lstrip('/')}"

        # Clean target directory
        clean_target = target_directory.strip().replace("\\", "/")
        if not clean_target.startswith("/"):
            raise ValueError("Target directory must be an absolute path")

        # Create target directory
        StorageService.execute_command(target_node_ip, f"mkdir -p {clean_target}")

        # Check for overwrite conflicts if overwrite is False
        check_cmd = f"ls -A {clean_target} 2>/dev/null"
        c_code, c_out, _ = StorageService.execute_command(target_node_ip, check_cmd)
        has_files = bool(c_out.strip())
        if has_files and not overwrite:
            return {
                "success": False,
                "has_conflicts": True,
                "conflict_warning": f"Target directory '{clean_target}' already contains files. Please confirm overwrite to proceed.",
                "existing_items": c_out.strip().split("\n")[:10],
            }

        # Perform restoration via rsync
        overwrite_flag = "--overwrite" if overwrite else ""
        restore_cmd = f"rsync -avz {source_path}/ {clean_target}/"
        t0 = time.time()
        code, out, err = StorageService.execute_command(target_node_ip, restore_cmd, timeout=300.0)
        duration = round(time.time() - t0, 2)

        if code != 0:
            raise RuntimeError(f"Restoration failed: {err}")

        # Verification check
        verify_cmd = f"ls -l {clean_target} | wc -l"
        _, v_out, _ = StorageService.execute_command(target_node_ip, verify_cmd)

        return {
            "success": True,
            "recovery_point_id": str(rp.id),
            "snapshot_id": rp.snapshot_id,
            "target_node": target_node_ip,
            "restored_to": clean_target,
            "duration_seconds": duration,
            "verified_items_count": int(v_out.strip()) if v_out.strip().isdigit() else 0,
            "message": f"Successfully restored snapshot {rp.snapshot_id} to '{clean_target}' in {duration}s.",
        }
