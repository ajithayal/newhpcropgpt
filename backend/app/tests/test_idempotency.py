import pytest
from sqlalchemy import select
from app.reconcile.queue import ReconcileQueue
from app.models.models import Operation, OperationTarget


@pytest.mark.asyncio
async def test_idempotency_key_deduplication(test_db, fake_ssh):
    """
    Submitting the same operation twice with the same idempotency key
    must return the existing operation without duplicating records in database.
    """
    idemp_key = "user_create_johnsmith_v1"
    targets = [{"host": "10.0.1.10", "role": "master"}]
    payload = {
        "username": "johnsmith",
        "uid": 10520,
        "gid": 10520,
    }

    # First call
    resp1 = await ReconcileQueue.enqueue(
        db=test_db,
        op_type="user_create",
        payload=payload,
        targets=targets,
        idempotency_key=idemp_key,
        apply_immediate=True,
    )

    # Second call with same idempotency key
    resp2 = await ReconcileQueue.enqueue(
        db=test_db,
        op_type="user_create",
        payload=payload,
        targets=targets,
        idempotency_key=idemp_key,
        apply_immediate=True,
    )

    # Must return identical operation ID
    assert resp1["operation_id"] == resp2["operation_id"]

    # Verify database has exactly 1 Operation and 1 OperationTarget
    ops = (await test_db.execute(
        select(Operation).where(Operation.idempotency_key == idemp_key)
    )).scalars().all()
    assert len(ops) == 1

    targets_in_db = (await test_db.execute(
        select(OperationTarget).where(OperationTarget.operation_id == ops[0].id)
    )).scalars().all()
    assert len(targets_in_db) == 1
