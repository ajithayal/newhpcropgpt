from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from uuid import UUID
from datetime import datetime
from typing import List, Dict, Any, Optional

from app.db.session import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import Operation, OperationTarget, TargetHealth, OperationStatus
from app.reconcile.worker import get_reconcile_worker

router = APIRouter(prefix="/operations", tags=["operations"])


@router.get("/health")
async def get_cluster_targets_health(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Returns live target health across all cluster hosts."""
    res = await db.execute(select(TargetHealth).order_by(TargetHealth.role.asc(), TargetHealth.host.asc()))
    rows = res.scalars().all()
    return [
        {
            "id": str(r.id),
            "host": r.host,
            "role": r.role,
            "online": r.online,
            "latency_ms": r.latency_ms,
            "last_seen": r.last_seen.isoformat() if r.last_seen else None,
            "last_error": r.last_error,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.get("")
async def list_operations(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Lists queued and completed operations with per-target status chips."""
    query = select(Operation).order_by(desc(Operation.created_at)).offset(skip).limit(limit)
    if status:
        query = query.where(Operation.status == status)

    res = await db.execute(query)
    operations = res.scalars().all()

    result = []
    for op in operations:
        target_res = await db.execute(
            select(OperationTarget).where(OperationTarget.operation_id == op.id)
        )
        targets = target_res.scalars().all()

        result.append({
            "id": str(op.id),
            "type": op.type,
            "status": op.status,
            "created_at": op.created_at.isoformat() if op.created_at else None,
            "targets": [
                {
                    "id": str(t.id),
                    "host": t.target_host,
                    "role": t.target_role,
                    "status": t.status,
                    "attempts": t.attempts,
                    "last_error": t.last_error,
                    "last_attempt_at": t.last_attempt_at.isoformat() if t.last_attempt_at else None,
                    "applied_at": t.applied_at.isoformat() if t.applied_at else None,
                }
                for t in targets
            ],
        })

    return result


@router.get("/{operation_id}")
async def get_operation_detail(
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retrieves full operation details including execution logs."""
    res = await db.execute(select(Operation).where(Operation.id == operation_id))
    op = res.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")

    target_res = await db.execute(
        select(OperationTarget).where(OperationTarget.operation_id == op.id)
    )
    targets = target_res.scalars().all()

    return {
        "id": str(op.id),
        "type": op.type,
        "status": op.status,
        "created_at": op.created_at.isoformat() if op.created_at else None,
        "targets": [
            {
                "id": str(t.id),
                "host": t.target_host,
                "role": t.target_role,
                "status": t.status,
                "attempts": t.attempts,
                "last_error": t.last_error,
                "last_attempt_at": t.last_attempt_at.isoformat() if t.last_attempt_at else None,
                "applied_at": t.applied_at.isoformat() if t.applied_at else None,
                "execution_log": t.execution_log,
            }
            for t in targets
        ],
    }


@router.post("/{operation_id}/retry")
async def retry_operation(
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Manually resets failed/skipped targets to pending and triggers reconcile worker."""
    res = await db.execute(select(Operation).where(Operation.id == operation_id))
    op = res.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")

    target_res = await db.execute(
        select(OperationTarget).where(OperationTarget.operation_id == op.id)
    )
    targets = target_res.scalars().all()
    for t in targets:
        if t.status in (OperationStatus.FAILED.value, OperationStatus.SKIPPED_OFFLINE.value, OperationStatus.PENDING.value):
            t.status = OperationStatus.PENDING.value
            t.next_retry_at = datetime.utcnow()

    op.status = OperationStatus.PENDING.value
    await db.commit()

    # Trigger worker in background
    worker = get_reconcile_worker()
    for t in targets:
        await worker.apply_single_target(db, t, op)

    return {"message": "Operation scheduled for immediate retry", "operation_id": str(op.id)}


@router.post("/{operation_id}/cancel")
async def cancel_operation(
    operation_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Cancels pending targets for an operation."""
    res = await db.execute(select(Operation).where(Operation.id == operation_id))
    op = res.scalar_one_or_none()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")

    target_res = await db.execute(
        select(OperationTarget).where(OperationTarget.operation_id == op.id)
    )
    targets = target_res.scalars().all()
    for t in targets:
        if t.status == OperationStatus.PENDING.value:
            t.status = OperationStatus.FAILED.value
            t.last_error = "Cancelled by administrator"

    op.status = OperationStatus.FAILED.value
    await db.commit()
    return {"message": "Operation cancelled", "operation_id": str(op.id)}
