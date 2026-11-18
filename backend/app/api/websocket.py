"""
WebSocket endpoint for real-time updates.
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Dict, Set

from fastapi import WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select
from app.core.database import async_session
from app.models.models import Node, HpcJob, StorageMount, Alert
from app.core.security import decode_access_token


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, tenant_id: str):
        await websocket.accept()
        if tenant_id not in self.active_connections:
            self.active_connections[tenant_id] = set()
        self.active_connections[tenant_id].add(websocket)

    def disconnect(self, websocket: WebSocket, tenant_id: str):
        if tenant_id in self.active_connections:
            self.active_connections[tenant_id].discard(websocket)
            if not self.active_connections[tenant_id]:
                del self.active_connections[tenant_id]

    async def broadcast_to_tenant(self, tenant_id: str, message: dict):
        if tenant_id in self.active_connections:
            dead = set()
            for connection in self.active_connections[tenant_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    dead.add(connection)
            for d in dead:
                self.active_connections[tenant_id].discard(d)


manager = ConnectionManager()


async def get_real_metrics(tenant_id: str) -> dict:
    async with async_session() as db:
        q_nodes = select(Node)
        if tenant_id and tenant_id != "default":
            q_nodes = q_nodes.where(Node.tenant_id == tenant_id)
        r_nodes = await db.execute(q_nodes)
        nodes = r_nodes.scalars().all()

        total_nodes = len(nodes)
        online_nodes = sum(1 for n in nodes if n.state in ["online", "idle", "allocated"])
        avg_cpu = round(sum(n.cpu_usage for n in nodes) / max(total_nodes, 1), 1)
        avg_mem = round(sum(n.memory_usage for n in nodes) / max(total_nodes, 1), 1)

        q_jobs = select(HpcJob)
        if tenant_id and tenant_id != "default":
            q_jobs = q_jobs.where(HpcJob.tenant_id == tenant_id)
        r_jobs = await db.execute(q_jobs)
        jobs = r_jobs.scalars().all()
        active_jobs = sum(1 for j in jobs if j.state == "running")
        pending_jobs = sum(1 for j in jobs if j.state == "pending")

        q_sm = select(StorageMount)
        if tenant_id and tenant_id != "default":
            q_sm = q_sm.where(StorageMount.tenant_id == tenant_id)
        r_sm = await db.execute(q_sm)
        mounts = r_sm.scalars().all()
        tot_storage = sum(m.total_gb for m in mounts)
        used_storage = sum(m.used_gb for m in mounts)
        storage_pct = round((used_storage / tot_storage * 100), 1) if tot_storage else 0.0

        return {
            "type": "metrics_update",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "cpu_usage": avg_cpu,
                "memory_usage": avg_mem,
                "gpu_usage": 0.0,
                "storage_usage": storage_pct,
                "network_in": 0.02,
                "network_out": 0.01,
                "active_jobs": active_jobs,
                "pending_jobs": pending_jobs,
                "online_nodes": online_nodes,
                "total_nodes": total_nodes,
            },
        }


async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):
    tenant_id = "default"
    if token:
        payload = decode_access_token(token)
        if payload:
            tenant_id = payload.get("tenant_id", "default")

    await manager.connect(websocket, tenant_id)
    try:
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()})
            except asyncio.TimeoutError:
                pass

            metrics = await get_real_metrics(tenant_id)
            await websocket.send_json(metrics)

            await asyncio.sleep(5)

    except WebSocketDisconnect:
        manager.disconnect(websocket, tenant_id)
    except Exception:
        manager.disconnect(websocket, tenant_id)
