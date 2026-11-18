"""
Enhanced Job Scheduler API — partitions, job detail, hold/release/requeue
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_role
from app.schemas.schemas import JobSubmit, JobResponse, PartitionCreate, PartitionResponse
from app.models.models import HpcJob, Partition, AuditLog

router = APIRouter()


@router.get("/scheduler/jobs", response_model=list[JobResponse])
async def list_jobs(
    skip: int = 0, limit: int = 100,
    state: str = None,
    partition: str = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = select(HpcJob).order_by(HpcJob.submitted_at.desc())
    if current_user.tenant_id:
        query = query.where(HpcJob.tenant_id == current_user.tenant_id)
    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin"):
        query = query.where(HpcJob.user_id == current_user.id)
    if state:
        query = query.where(HpcJob.state == state)
    if partition:
        query = query.where(HpcJob.partition == partition)
    result = await db.execute(query.offset(skip).limit(limit))
    return [JobResponse.model_validate(j) for j in result.scalars().all()]


@router.get("/scheduler/jobs/{job_id}", response_model=JobResponse)
async def get_job_detail(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(HpcJob).where(HpcJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse.model_validate(job)


@router.post("/scheduler/jobs/submit", response_model=JobResponse)
async def submit_job(
    data: JobSubmit,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    job = HpcJob(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        name=data.name,
        partition=data.partition,
        nodes=data.nodes,
        tasks=data.tasks,
        gpus=data.gpus,
        walltime=data.walltime,
        memory=data.memory,
        script=data.script,
        output_path=data.output_path,
        error_path=data.error_path,
        state="pending",
    )
    db.add(job)
    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="job_submit", resource_type="job",
        details={"name": data.name, "partition": data.partition},
    ))
    await db.commit()
    await db.refresh(job)
    return JobResponse.model_validate(job)


@router.post("/scheduler/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(HpcJob).where(HpcJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin") and job.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    job.state = "cancelled"
    job.completed_at = datetime.utcnow()
    await db.commit()
    return {"status": "cancelled"}


@router.post("/scheduler/jobs/{job_id}/hold")
async def hold_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    result = await db.execute(select(HpcJob).where(HpcJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.state = "held"
    await db.commit()
    return {"status": "held"}


@router.post("/scheduler/jobs/{job_id}/release")
async def release_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    result = await db.execute(select(HpcJob).where(HpcJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.state = "pending"
    await db.commit()
    return {"status": "released"}


@router.post("/scheduler/jobs/{job_id}/requeue")
async def requeue_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    result = await db.execute(select(HpcJob).where(HpcJob.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.state = "pending"
    job.exit_code = None
    job.started_at = None
    job.completed_at = None
    await db.commit()
    return {"status": "requeued"}


@router.get("/scheduler/stats")
async def get_scheduler_stats(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query_base = select(HpcJob)
    if current_user.tenant_id:
        query_base = query_base.where(HpcJob.tenant_id == current_user.tenant_id)

    total = (await db.execute(select(func.count(HpcJob.id)).where(
        HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id))
    )).scalar() or 0
    running = (await db.execute(select(func.count(HpcJob.id)).where(HpcJob.state == "running").where(
        HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id)).where(HpcJob.state == "running")
    )).scalar() or 0
    pending = (await db.execute(select(func.count(HpcJob.id)).where(HpcJob.state == "pending").where(
        HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id)).where(HpcJob.state == "pending")
    )).scalar() or 0
    completed = (await db.execute(select(func.count(HpcJob.id)).where(HpcJob.state == "completed").where(
        HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id)).where(HpcJob.state == "completed")
    )).scalar() or 0
    failed = (await db.execute(select(func.count(HpcJob.id)).where(HpcJob.state == "failed").where(
        HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id)).where(HpcJob.state == "failed")
    )).scalar() or 0

    return {"total": total, "running": running, "pending": pending, "completed": completed, "failed": failed}


# --- Partitions ---

@router.get("/scheduler/partitions", response_model=list[PartitionResponse])
async def list_partitions(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = select(Partition).order_by(Partition.name)
    if current_user.tenant_id:
        query = query.where(Partition.tenant_id == current_user.tenant_id)
    result = await db.execute(query)
    return [PartitionResponse.model_validate(p) for p in result.scalars().all()]


@router.post("/scheduler/partitions", response_model=PartitionResponse)
async def create_partition(
    data: PartitionCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    existing = await db.execute(select(Partition).where(Partition.name == data.name).where(
        Partition.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(Partition).where(Partition.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Partition already exists")
    partition = Partition(**data.model_dump(), tenant_id=current_user.tenant_id, status="active")
    db.add(partition)
    await db.commit()
    await db.refresh(partition)
    return PartitionResponse.model_validate(partition)


@router.put("/scheduler/partitions/{partition_id}", response_model=PartitionResponse)
async def update_partition(
    partition_id: UUID,
    data: PartitionCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    result = await db.execute(select(Partition).where(Partition.id == partition_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Partition not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(p, key, value)
    await db.commit()
    await db.refresh(p)
    return PartitionResponse.model_validate(p)


@router.delete("/scheduler/partitions/{partition_id}")
async def delete_partition(
    partition_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    result = await db.execute(select(Partition).where(Partition.id == partition_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Partition not found")
    await db.delete(p)
    await db.commit()
    return {"status": "deleted"}
