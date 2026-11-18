import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.models import Operation, OperationTarget, TargetHealth, OperationStatus
from app.core.crypto import encrypt_payload_dict, decrypt_payload_dict, purge_secrets_from_dict
from app.remote.ssh_executor import get_ssh_executor

logger = logging.getLogger("ayalhpc.reconcile.queue")


class ReconcileQueue:
    @staticmethod
    async def get_host_health(db: AsyncSession, host: str) -> Optional[TargetHealth]:
        result = await db.execute(select(TargetHealth).where(TargetHealth.host == host))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_cluster_targets(db: AsyncSession) -> List[Dict[str, str]]:
        from app.models.models import Node
        res = await db.execute(select(Node))
        nodes = res.scalars().all()
        targets = []
        for n in nodes:
            host = n.address or n.management_ip or n.hostname
            if host:
                targets.append({
                    "host": host,
                    "hostname": n.hostname,
                    "role": "master" if (n.node_type in ["master", "controller"] or "master" in (n.hostname or "").lower()) else "worker",
                })
        return targets

    @staticmethod
    async def is_host_online(db: AsyncSession, host: str) -> bool:
        health = await ReconcileQueue.get_host_health(db, host)
        if health and health.online:
            return True
        # If not in target_health or false, check with fast socket check
        executor = get_ssh_executor()
        online, _, _ = executor.test_connection(host, timeout=2.0)
        return online

    @staticmethod
    async def enqueue(
        db: AsyncSession,
        op_type: str,
        payload: Dict[str, Any],
        targets: List[Dict[str, str]],  # [{"host": "10.0.1.10", "role": "master"}, ...]
        created_by: Optional[UUID] = None,
        idempotency_key: Optional[str] = None,
        tenant_id: Optional[UUID] = None,
        apply_immediate: bool = True,
    ) -> Dict[str, Any]:
        """
        Enqueues an operation into the desired state pipeline.
        - Validates idempotency
        - Encrypts sensitive secrets in payload with Fernet
        - Creates target rows
        - Tries immediate apply if host is online
        - Formulates a per-target result summary (never blanket success)
        """
        # Idempotency check
        if idempotency_key:
            existing = await db.execute(
                select(Operation).where(Operation.idempotency_key == idempotency_key)
            )
            op = existing.scalar_one_or_none()
            if op:
                logger.info(f"Operation with idempotency_key {idempotency_key} already exists (id={op.id})")
                return await ReconcileQueue.format_operation_response(db, op)

        # Encrypt secrets in payload
        secure_payload = encrypt_payload_dict(payload)
        payload_str = json.dumps(secure_payload)

        operation = Operation(
            type=op_type,
            payload_json=payload_str,
            created_by=created_by,
            idempotency_key=idempotency_key,
            status=OperationStatus.PENDING.value,
            tenant_id=tenant_id,
        )
        db.add(operation)
        await db.flush()

        op_targets: List[OperationTarget] = []
        for t in targets:
            host = t.get("host") or ""
            role = t.get("role") or "node"
            if not host:
                continue
            target_row = OperationTarget(
                operation_id=operation.id,
                target_host=host,
                target_role=role,
                status=OperationStatus.PENDING.value,
                attempts=0,
            )
            db.add(target_row)
            op_targets.append(target_row)

        await db.commit()
        await db.refresh(operation)

        # Immediate apply for online targets
        if apply_immediate:
            from app.reconcile.worker import get_reconcile_worker
            worker = get_reconcile_worker()
            for target_row in op_targets:
                host_online = await ReconcileQueue.is_host_online(db, target_row.target_host)
                if host_online:
                    try:
                        await worker.apply_single_target(db, target_row, operation)
                    except Exception as ex:
                        logger.warning(f"Immediate apply failed for {target_row.target_host}: {ex}")
                else:
                    target_row.status = OperationStatus.PENDING.value
                    target_row.last_error = f"Target {target_row.target_host} is offline"
                    await db.commit()

        await db.refresh(operation)
        return await ReconcileQueue.format_operation_response(db, operation)

    @staticmethod
    async def format_operation_response(db: AsyncSession, operation: Operation) -> Dict[str, Any]:
        """
        Generates strict per-target outcome response.
        NEVER returns blanket success if any target is offline or failed.
        """
        res = await db.execute(
            select(OperationTarget).where(OperationTarget.operation_id == operation.id)
        )
        targets = list(res.scalars().all())

        per_target: Dict[str, Dict[str, Any]] = {}
        applied_count = 0
        offline_count = 0
        failed_count = 0

        for t in targets:
            per_target[t.target_host] = {
                "role": t.target_role,
                "status": t.status,
                "attempts": t.attempts,
                "last_error": t.last_error,
                "applied_at": t.applied_at.isoformat() if t.applied_at else None,
            }
            if t.status == OperationStatus.APPLIED.value:
                applied_count += 1
            elif t.status in (OperationStatus.PENDING.value, OperationStatus.SKIPPED_OFFLINE.value):
                offline_count += 1
            elif t.status == OperationStatus.FAILED.value:
                failed_count += 1

        total = len(targets)
        if total == 0:
            summary = "Applied (no targets)"
            aggregate_status = OperationStatus.APPLIED.value
        elif applied_count == total:
            summary = "Applied across all target cluster nodes"
            aggregate_status = OperationStatus.APPLIED.value
        elif offline_count > 0 and failed_count == 0:
            offline_hosts = [t.target_host for t in targets if t.status in (OperationStatus.PENDING.value, OperationStatus.SKIPPED_OFFLINE.value)]
            summary = f"Saved desired state. Pending on: {', '.join(offline_hosts)} (offline)"
            aggregate_status = OperationStatus.PENDING.value
        elif failed_count > 0:
            failed_hosts = [f"{t.target_host} ({t.last_error})" for t in targets if t.status == OperationStatus.FAILED.value]
            summary = f"Failed on: {'; '.join(failed_hosts)}"
            aggregate_status = OperationStatus.FAILED.value
        else:
            summary = f"Partially applied ({applied_count}/{total} nodes)"
            aggregate_status = OperationStatus.PARTIAL.value

        operation.status = aggregate_status
        await db.commit()

        return {
            "operation_id": str(operation.id),
            "type": operation.type,
            "status": aggregate_status,
            "summary_message": summary,
            "targets": per_target,
            "created_at": operation.created_at.isoformat() if operation.created_at else None,
        }
