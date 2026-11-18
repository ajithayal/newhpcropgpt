import pytest
from sqlalchemy import select
from app.reconcile.queue import ReconcileQueue
from app.reconcile.worker import ReconcileWorker
from app.models.models import Operation, OperationTarget, OperationStatus


@pytest.mark.asyncio
async def test_reconcile_offline_host_flow(test_db, fake_ssh):
    """
    Core verification test:
    Mutating action on mixed cluster (online master + offline worker).
    Asserts:
    1. Master applied immediately (APPLIED).
    2. Worker is NOT applied, remains PENDING.
    3. Aggregate response status is PENDING, NOT green success.
    4. When worker comes back online, worker loop applies and transitions to APPLIED.
    """
    fake_ssh.set_host_online("10.0.1.10", True)
    fake_ssh.set_host_online("offline.node", False)

    targets = [
        {"host": "10.0.1.10", "role": "master"},
        {"host": "offline.node", "role": "worker"},
    ]
    payload = {
        "username": "testuser01",
        "uid": 10505,
        "gid": 10505,
        "password": "Password123!",
    }

    # Step 1: Enqueue
    resp = await ReconcileQueue.enqueue(
        db=test_db,
        op_type="user_create",
        payload=payload,
        targets=targets,
        apply_immediate=True,
    )

    # CRITICAL: Must not report blanket success
    assert resp["status"] == OperationStatus.PENDING.value
    assert "Pending on: offline.node (offline)" in resp["summary_message"]

    # Verify per-target outcomes
    assert resp["targets"]["10.0.1.10"]["status"] == OperationStatus.APPLIED.value
    assert resp["targets"]["offline.node"]["status"] == OperationStatus.PENDING.value

    # Verify database state
    op_id = resp["operation_id"]
    db_targets = (await test_db.execute(
        select(OperationTarget).where(OperationTarget.operation_id == op_id)
    )).scalars().all()

    assert len(db_targets) == 2
    master_target = next(t for t in db_targets if t.target_host == "10.0.1.10")
    worker_target = next(t for t in db_targets if t.target_host == "offline.node")

    assert master_target.status == OperationStatus.APPLIED.value
    assert worker_target.status == OperationStatus.PENDING.value
    assert "offline" in worker_target.last_error.lower()

    # Step 2: Simulate offline node reconnecting
    fake_ssh.set_host_online("offline.node", True)

    worker = ReconcileWorker()
    # Apply single pending target now that host is reachable
    db_op = (await test_db.execute(select(Operation).where(Operation.id == op_id))).scalar_one()
    await worker.apply_single_target(test_db, worker_target, db_op)

    # Verify worker target is now applied
    await test_db.refresh(worker_target)
    assert worker_target.status == OperationStatus.APPLIED.value

    # Verify aggregate response is now fully applied
    updated_resp = await ReconcileQueue.format_operation_response(test_db, db_op)
    assert updated_resp["status"] == OperationStatus.APPLIED.value
    assert "Applied across all target cluster nodes" in updated_resp["summary_message"]
