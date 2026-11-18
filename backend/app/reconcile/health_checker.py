import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import Node, TargetHealth, OperationTarget, OperationStatus
from app.db.session import async_session
from app.remote.ssh_executor import get_ssh_executor
from app.reconcile.worker import get_reconcile_worker
from app.api.websocket import manager as ws_manager

logger = logging.getLogger("ayalhpc.reconcile.health")


class HealthCheckerService:
    _instance: Optional["HealthCheckerService"] = None

    def __init__(self):
        self._running: bool = False
        self._task: Optional[asyncio.Task] = None
        self._last_state: Dict[str, bool] = {}  # host -> was_online

    @classmethod
    def get_instance(cls) -> "HealthCheckerService":
        if cls._instance is None:
            cls._instance = HealthCheckerService()
        return cls._instance

    def start(self):
        if not self._running:
            self._running = True
            self._task = asyncio.create_task(self._check_loop())
            logger.info("AYAL HPC 15s Health Checker Service started.")

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None
            logger.info("AYAL HPC Health Checker Service stopped.")

    async def _check_loop(self):
        # Initial wait to let server start up cleanly
        await asyncio.sleep(2)
        while self._running:
            try:
                await self.check_all_targets()
            except Exception as e:
                logger.error(f"Error in health check loop: {e}", exc_info=True)
            await asyncio.sleep(15)  # Strict 15 second loop as required

    async def check_all_targets(self):
        executor = get_ssh_executor()

        async with async_session() as db:
            # Query all registered nodes
            nodes_res = await db.execute(select(Node))
            nodes = nodes_res.scalars().all()

            health_updates = []

            for node in nodes:
                host = node.address or node.management_ip or node.hostname
                if not host:
                    continue

                role = "master" if node.node_type == "master" else "node"

                # Check connectivity (TCP 22 + SSH 'true')
                online, latency, err = executor.test_connection(host, timeout=3.0)

                # Fetch or create TargetHealth row
                th_res = await db.execute(select(TargetHealth).where(TargetHealth.host == host))
                th = th_res.scalar_one_or_none()
                if not th:
                    th = TargetHealth(host=host, role=role)
                    db.add(th)

                was_online = self._last_state.get(host, th.online)

                th.online = online
                th.role = role
                th.latency_ms = int(latency) if latency else None
                th.last_error = err
                th.updated_at = datetime.utcnow()
                if online:
                    th.last_seen = datetime.utcnow()

                # State Transition: OFFLINE -> ONLINE
                if not was_online and online:
                    logger.info(f"Target transition detected: {host} went from OFFLINE to ONLINE.")
                    # Trigger reconcile on reconnect in background
                    asyncio.create_task(
                        get_reconcile_worker().reconcile_host_on_reconnect(host, role)
                    )

                # State Transition: ONLINE -> OFFLINE
                elif was_online and not online:
                    logger.warning(f"Target transition detected: {host} went from ONLINE to OFFLINE.")
                    # Mark any currently 'applying' operation targets on that host as skipped_offline
                    running_res = await db.execute(
                        select(OperationTarget).where(
                            OperationTarget.target_host == host,
                            OperationTarget.status == OperationStatus.APPLYING.value,
                        )
                    )
                    for running_target in running_res.scalars().all():
                        running_target.status = OperationStatus.SKIPPED_OFFLINE.value
                        running_target.last_error = f"Host {host} went offline during execution"

                self._last_state[host] = online
                health_updates.append({
                    "host": host,
                    "hostname": node.hostname,
                    "role": role,
                    "online": online,
                    "latency_ms": th.latency_ms,
                    "last_seen": th.last_seen.isoformat() if th.last_seen else None,
                    "last_error": err,
                })

            await db.commit()

            # Broadcast health status over /ws
            try:
                await ws_manager.broadcast({
                    "type": "target_health",
                    "targets": health_updates,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            except Exception:
                pass
