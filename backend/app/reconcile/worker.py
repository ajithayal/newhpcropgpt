import asyncio
import json
import logging
from typing import Dict, Any, Optional, Set
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.models.models import Operation, OperationTarget, TargetHealth, OperationStatus, User
from app.db.session import async_session
from app.core.crypto import decrypt_payload_dict, purge_secrets_from_dict
from app.reconcile.handlers import (
    UserReconcileHandler,
    NfsReconcileHandler,
    AppsStorageReconcileHandler,
    PackageReconcileHandler,
)
from app.api.websocket import manager as ws_manager

logger = logging.getLogger("ayalhpc.reconcile.worker")


class ReconcileWorker:
    def __init__(self):
        self._host_locks: Dict[str, asyncio.Lock] = {}
        self._running: bool = False
        self._task: Optional[asyncio.Task] = None

    def _get_host_lock(self, host: str) -> asyncio.Lock:
        if host not in self._host_locks:
            self._host_locks[host] = asyncio.Lock()
        return self._host_locks[host]

    def start(self):
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._reconcile_loop())
            logger.info("AYAL HPC Reconcile Worker started.")

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("AYAL HPC Reconcile Worker stopped.")

    async def _reconcile_loop(self):
        while self._running:
            try:
                await self.process_pending_operations()
            except Exception as e:
                logger.error(f"Error in reconcile loop: {e}", exc_info=True)
            await asyncio.sleep(5)  # Polling cycle every 5s

    async def process_pending_operations(self):
        async with async_session() as db:
            now = datetime.utcnow()
            # Select pending or retriable targets whose next_retry_at is <= now or null
            stmt = (
                select(OperationTarget, Operation)
                .join(Operation, OperationTarget.operation_id == Operation.id)
                .where(
                    OperationTarget.status.in_([
                        OperationStatus.PENDING.value,
                        OperationStatus.FAILED.value,
                    ]),
                    or_(
                        OperationTarget.next_retry_at.is_(None),
                        OperationTarget.next_retry_at <= now,
                    )
                )
                .order_by(Operation.created_at.asc())
                .limit(20)
            )
            res = await db.execute(stmt)
            rows = res.all()

            for target_row, op in rows:
                # Master-first dependency check: if target is a compute node, check if master operation target is still pending
                if target_row.target_role != "master":
                    master_pending_stmt = select(OperationTarget).where(
                        OperationTarget.operation_id == op.id,
                        OperationTarget.target_role == "master",
                        OperationTarget.status != OperationStatus.APPLIED.value,
                    )
                    master_res = await db.execute(master_pending_stmt)
                    if master_res.scalar_one_or_none():
                        # Wait for master to be applied first
                        continue

                # Acquire lock per host so multiple workers do not collide on the same machine
                lock = self._get_host_lock(target_row.target_host)
                if lock.locked():
                    continue

                async with lock:
                    await self.apply_single_target(db, target_row, op)

    async def apply_single_target(self, db: AsyncSession, target: OperationTarget, op: Operation):
        target.status = OperationStatus.APPLYING.value
        target.last_attempt_at = datetime.utcnow()
        target.attempts += 1
        await db.commit()

        # Broadcast state
        try:
            await ws_manager.broadcast({
                "type": "operation_status",
                "operation_id": str(op.id),
                "target_host": target.target_host,
                "status": "applying",
                "attempt": target.attempts,
            })
        except Exception:
            pass

        # Decrypt payload secrets just-in-time
        try:
            raw_payload = json.loads(op.payload_json)
            decrypted_payload = decrypt_payload_dict(raw_payload)
        except Exception as e:
            target.status = OperationStatus.FAILED.value
            target.last_error = f"Failed to decrypt operation payload: {e}"
            await db.commit()
            return

        success = False
        exec_log = ""
        error_msg = ""

        try:
            op_type = op.type
            if op_type.startswith("user_"):
                success, exec_log, error_msg = UserReconcileHandler.apply(
                    target.target_host, op_type, decrypted_payload
                )
            elif op_type.startswith("nfs_"):
                success, exec_log, error_msg = NfsReconcileHandler.apply(
                    target.target_host, op_type, decrypted_payload
                )
            elif op_type.startswith("apps_"):
                success, exec_log, error_msg = AppsStorageReconcileHandler.apply(
                    target.target_host, op_type, decrypted_payload
                )
            elif op_type.startswith("package_"):
                success, exec_log, error_msg = PackageReconcileHandler.apply(
                    target.target_host, op_type, decrypted_payload
                )
            else:
                error_msg = f"Unknown operation type: {op_type}"
        except Exception as ex:
            error_msg = str(ex)
            success = False

        target.execution_log = exec_log

        if success:
            target.status = OperationStatus.APPLIED.value
            target.applied_at = datetime.utcnow()
            target.last_error = None
            target.next_retry_at = None
            logger.info(f"Operation {op.id} ({op.type}) applied successfully on {target.target_host}.")

            # Purge secrets from the operation payload once applied everywhere
            all_targets_stmt = select(OperationTarget).where(OperationTarget.operation_id == op.id)
            all_res = await db.execute(all_targets_stmt)
            all_tgts = all_res.scalars().all()
            if all(t.status == OperationStatus.APPLIED.value for t in all_tgts):
                purged = purge_secrets_from_dict(raw_payload)
                op.payload_json = json.dumps(purged)
                op.status = OperationStatus.APPLIED.value
        else:
            target.status = OperationStatus.FAILED.value
            target.last_error = error_msg
            # Exponential backoff capped at 10 minutes (600s): 10s, 20s, 40s, 80s, 160s, 320s, 600s
            backoff_secs = min(600, 10 * (2 ** (target.attempts - 1)))
            target.next_retry_at = datetime.utcnow() + timedelta(seconds=backoff_secs)
            logger.warning(f"Operation {op.id} failed on {target.target_host} (attempt {target.attempts}): {error_msg}. Retry in {backoff_secs}s")

        await db.commit()

        # Broadcast update
        try:
            await ws_manager.broadcast({
                "type": "operation_status",
                "operation_id": str(op.id),
                "target_host": target.target_host,
                "status": target.status,
                "applied_at": target.applied_at.isoformat() if target.applied_at else None,
                "error": target.last_error,
            })
        except Exception:
            pass

    async def reconcile_host_on_reconnect(self, host: str, role: str):
        """
        Triggered when a host transitions from offline to online.
        1. Immediately process any pending / failed operations for this host.
        2. Run drift check (compare DB desired state with real state and fix).
        """
        logger.info(f"Host {host} ({role}) returned online! Triggering immediate reconciliation...")
        async with async_session() as db:
            # Reset skipped_offline or failed targets for this host to pending with immediate retry
            stmt = select(OperationTarget).where(
                OperationTarget.target_host == host,
                OperationTarget.status.in_([
                    OperationStatus.PENDING.value,
                    OperationStatus.FAILED.value,
                    OperationStatus.SKIPPED_OFFLINE.value,
                ]),
            )
            res = await db.execute(stmt)
            for target in res.scalars().all():
                target.status = OperationStatus.PENDING.value
                target.next_retry_at = datetime.utcnow()
            await db.commit()

        # Run worker processing for this host
        await self.process_pending_operations()

        # Run drift check
        await self.drift_check_host(host, role)

    async def drift_check_host(self, host: str, role: str):
        """
        Compares DB desired state (users, quotas) with real node state and fixes drift.
        """
        logger.info(f"Running drift check on {host} ({role})...")
        from app.remote.ssh_executor import get_ssh_executor
        from app.remote.commands import CommandBuilder
        executor = get_ssh_executor()

        async with async_session() as db:
            users_res = await db.execute(select(User).where(User.is_active == True))
            users = users_res.scalars().all()

            for u in users:
                # Check if user exists on real host
                check = executor.execute(host, CommandBuilder.user_id(u.username))
                if not check.success:
                    logger.warning(f"Drift detected on {host}: user '{u.username}' missing from OS. Recreating...")
                    uid = int(u.freeipa_uid or 10001)
                    gid = int(u.freeipa_gid or uid)
                    home = f"/home/{u.username}"
                    executor.execute(host, CommandBuilder.user_create(u.username, uid, gid, home))
                    executor.execute(host, CommandBuilder.dir_ensure(home, uid, gid, mode="700"))
                else:
                    # Verify home directory permissions (POSIX 0700)
                    home = f"/home/{u.username}"
                    executor.execute(host, f"chmod 700 {home} 2>/dev/null || true")

            # Check /apps mount if worker
            if role != "master":
                mnt_check = executor.execute(host, CommandBuilder.findmnt("/apps"))
                if not mnt_check.success or not mnt_check.stdout:
                    logger.warning(f"Drift detected on {host}: /apps not mounted. Triggering mount...")
                    executor.execute(host, "mount /apps 2>/dev/null || mount -a")


_worker_instance: Optional[ReconcileWorker] = None

def get_reconcile_worker() -> ReconcileWorker:
    global _worker_instance
    if _worker_instance is None:
        _worker_instance = ReconcileWorker()
    return _worker_instance
