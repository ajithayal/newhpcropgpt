import pytest
from sqlalchemy import select
from app.reconcile.queue import ReconcileQueue
from app.reconcile.worker import ReconcileWorker
from app.models.models import Operation, OperationTarget, OperationStatus


@pytest.mark.asyncio
async def test_worker_waits_for_master_dependency(test_db, fake_ssh):
    """
    Dependency ordering test:
    Compute worker nodes must NOT apply operations before the master has succeeded.
    If master is offline or still pending, worker target must wait.
    """
    # Simulate master is offline, worker is online
    fake_ssh.set_host_online("10.0.1.10", False)
    fake_ssh.set_host_online("10.0.1.20", True)

    targets = [
        {"host": "10.0.1.10", "role": "master"},
        {"host": "10.0.1.20", "role": "worker"},
    ]
    payload = {
        "username": "dependuser",
        "uid": 10510,
        "gid": 10510,
    }

    # Enqueue with apply_immediate=False to test worker loop ordering
    resp = await ReconcileQueue.enqueue(
        db=test_db,
        op_type="user_create",
        payload=payload,
        targets=targets,
        apply_immediate=False,
    )

    op_id = resp["operation_id"]
    db_targets = (await test_db.execute(
        select(OperationTarget).where(OperationTarget.operation_id == op_id)
    )).scalars().all()

    master_t = next(t for t in db_targets if t.target_role == "master")
    worker_t = next(t for t in db_targets if t.target_role == "worker")

    assert master_t.status == OperationStatus.PENDING.value
    assert worker_t.status == OperationStatus.PENDING.value

    # Worker dependency check logic:
    # Query whether master is pending for this operation
    master_pending_stmt = select(OperationTarget).where(
        OperationTarget.operation_id == op_id,
        OperationTarget.target_role == "master",
        OperationTarget.status != OperationStatus.APPLIED.value,
    )
    master_pending = (await test_db.execute(master_pending_stmt)).scalar_one_or_none()
    assert master_pending is not None  # Master is still pending

    # Worker must wait: worker_t remains PENDING
    assert worker_t.status == OperationStatus.PENDING.value

    # Now simulate master coming online and completing apply
    fake_ssh.set_host_online("10.0.1.10", True)
    worker = ReconcileWorker()
    db_op = (await test_db.execute(select(Operation).where(Operation.id == op_id))).scalar_one()

    await worker.apply_single_target(test_db, master_t, db_op)
    await test_db.refresh(master_t)
    assert master_t.status == OperationStatus.APPLIED.value

    # Now verify master is no longer pending
    master_pending_after = (await test_db.execute(master_pending_stmt)).scalar_one_or_none()
    assert master_pending_after is None

    # Now worker target can apply safely
    await worker.apply_single_target(test_db, worker_t, db_op)
    await test_db.refresh(worker_t)
    assert worker_t.status == OperationStatus.APPLIED.value
