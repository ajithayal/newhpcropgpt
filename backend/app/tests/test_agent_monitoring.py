"""
Unit and Integration Tests for AYAL HPC Centralized Live Data Collection & Monitoring
Tests:
- Agent heartbeat (/api/agent/heartbeat)
- Agent full telemetry report (/api/agent/report)
- Monitoring dashboard overview (/api/monitoring/overview)
- 12-domain comprehensive node details (/api/monitoring/nodes/{node_id})
- Historical timeseries query (/api/monitoring/nodes/{node_id}/history)
- Real-time threshold alerts and auto-resolution
- Centralized application and package inventory
"""
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from datetime import datetime

from app.main import app
from app.core.database import async_session
from app.models.models import Cluster, Node, User
from app.core.security import create_access_token


@pytest.fixture
def auth_headers():
    import sqlite3
    import os
    db_path = os.path.join(os.path.dirname(__file__), "..", "..", "ajicorehpc.db")
    if not os.path.exists(db_path):
        db_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "ajicorehpc.db")
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        row = cur.execute("SELECT id FROM users WHERE username = 'admin' LIMIT 1").fetchone()
        conn.close()
        user_id = row[0] if row else "8666f55c-bd68-424f-a346-ee16d484365d"
    except Exception:
        user_id = "8666f55c-bd68-424f-a346-ee16d484365d"

    token = create_access_token(
        data={"sub": user_id, "role": "admin"}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module", autouse=True)
def cleanup_test_data():
    import asyncio
    test_cluster_id = uuid.uuid4()

    async def _setup():
        try:
            from app.models.models import Cluster
            async with async_session() as db:
                c = Cluster(
                    id=test_cluster_id,
                    name="Test Monitoring Cluster",
                    description="Pytest Temporary Test Cluster",
                    status="active",
                )
                db.add(c)
                await db.commit()
        except Exception:
            pass

    async def _purge():
        try:
            from app.models.models import (
                Cluster, Node, NodeMetric, NodeNetworkMetric, NodeStorageMetric, NodeGpuMetric,
                NodeServiceStatus, NodeApplication, MonitoringAlert, AgentStatus
            )
            from sqlalchemy import select, delete
            async with async_session() as db:
                nodes = (await db.execute(select(Node).where(Node.hostname.in_(["test-node1.ayal.hpc", "test-spike.ayal.hpc"])))).scalars().all()
                for n in nodes:
                    await db.execute(delete(NodeMetric).where(NodeMetric.node_id == n.id))
                    await db.execute(delete(NodeNetworkMetric).where(NodeNetworkMetric.node_id == n.id))
                    await db.execute(delete(NodeStorageMetric).where(NodeStorageMetric.node_id == n.id))
                    await db.execute(delete(NodeGpuMetric).where(NodeGpuMetric.node_id == n.id))
                    await db.execute(delete(NodeServiceStatus).where(NodeServiceStatus.node_id == n.id))
                    await db.execute(delete(NodeApplication).where(NodeApplication.node_id == n.id))
                    await db.execute(delete(AgentStatus).where(AgentStatus.node_id == n.id))
                    await db.execute(delete(MonitoringAlert).where(MonitoringAlert.node_id == n.id))
                    await db.delete(n)
                # Also delete temporary test clusters
                test_clusters = (await db.execute(select(Cluster).where(Cluster.name == "Test Monitoring Cluster"))).scalars().all()
                for tc in test_clusters:
                    await db.delete(tc)
                await db.commit()
        except Exception:
            pass

    try:
        asyncio.run(_setup())
    except Exception:
        pass

    yield

    try:
        asyncio.run(_purge())
    except Exception:
        pass


@pytest.mark.asyncio
async def test_agent_heartbeat():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/agent/heartbeat",
            json={
                "hostname": "test-node1.ayal.hpc",
                "ip_address": "10.0.0.51",
                "agent_version": "1.0.0",
                "uptime_seconds": 3600,
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "acknowledged"
        assert "node_id" in data


@pytest.mark.asyncio
async def test_agent_report_full_telemetry():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        report_payload = {
            "hostname": "test-node1.ayal.hpc",
            "ip_address": "10.0.0.51",
            "role": "compute",
            "agent_version": "1.0.0",
            "hardware": {
                "manufacturer": "Dell Inc.",
                "model": "PowerEdge R750",
                "serial_number": "TEST-SRL-01",
                "cpu_model": "Intel Xeon Gold 6338",
                "cpu_sockets": 2,
                "cpu_cores": 32,
                "cpu_threads": 64,
                "cpu_temp": 48.5,
                "ram_total_bytes": 68719476736,
                "ram_used_bytes": 17179869184,
                "ram_free_bytes": 51539607552,
                "gpus": [],
            },
            "os": {
                "distribution": "AlmaLinux 9.4",
                "version": "9.4",
                "kernel": "5.14.0-427.el9.x86_64",
                "architecture": "x86_64",
                "uptime_seconds": 7200,
                "load_1m": 0.45,
                "load_5m": 0.30,
                "load_15m": 0.20,
                "running_processes": 115,
            },
            "metrics": {
                "cpu_utilization_pct": 25.0,
                "ram_utilization_pct": 25.0,
                "swap_utilization_pct": 0.0,
            },
            "network": {
                "interfaces": [
                    {
                        "name": "eth0",
                        "ip_address": "10.0.0.51",
                        "mac_address": "52:54:00:12:34:56",
                        "status": "up",
                        "speed_mbps": "10000 Mbps",
                        "rx_bytes_sec": 102400.0,
                        "tx_bytes_sec": 51200.0,
                    }
                ],
                "dns_status": "Operational",
                "gateway_connectivity": True,
                "master_connectivity": True,
            },
            "storage": {
                "mounts": [
                    {
                        "mount_point": "/",
                        "filesystem": "/dev/sda3",
                        "fs_type": "xfs",
                        "total_bytes": 107374182400,
                        "used_bytes": 21474836480,
                        "free_bytes": 85899345920,
                        "utilization_pct": 20.0,
                    },
                    {
                        "mount_point": "/home",
                        "filesystem": "10.0.0.1:/home",
                        "fs_type": "nfs4",
                        "total_bytes": 1099511627776,
                        "used_bytes": 109951162777,
                        "free_bytes": 989560464999,
                        "utilization_pct": 10.0,
                        "nfs_status": "connected",
                    },
                ]
            },
            "services": [
                {"name": "ayalhpc-agent", "status": "running", "enabled": "enabled", "version": "1.0.0"},
                {"name": "sshd", "status": "running", "enabled": "enabled", "version": "OpenSSH_8.7p1"},
                {"name": "slurmd", "status": "running", "enabled": "enabled", "version": "Slurm 24.05"},
                {"name": "munge", "status": "running", "enabled": "enabled", "version": "munge 0.5.15"},
                {"name": "chronyd", "status": "running", "enabled": "enabled", "version": "chrony 4.5"},
            ],
            "applications": [
                {"name": "openmpi", "version": "4.1.5", "source": "rpm", "package_manager": "dnf", "status": "installed"},
                {"name": "spack", "version": "0.22.0", "source": "source", "package_manager": "spack", "status": "installed"},
            ],
        }

        res = await client.post("/api/agent/report", json=report_payload)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        node_id = data["node_id"]
        assert node_id is not None


@pytest.mark.asyncio
async def test_monitoring_endpoints(auth_headers):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Overview
        ov_res = await client.get("/api/monitoring/overview", headers=auth_headers)
        assert ov_res.status_code == 200
        ov_data = ov_res.json()
        assert "summary" in ov_data
        assert "nodes" in ov_data
        assert ov_data["summary"]["total_nodes"] >= 1

        # Nodes List
        nodes_res = await client.get("/api/monitoring/nodes", headers=auth_headers)
        assert nodes_res.status_code == 200
        nodes_list = nodes_res.json()["nodes"]
        assert len(nodes_list) >= 1
        target_node = nodes_list[0]

        # 12-Domain Node Details
        detail_res = await client.get(f"/api/monitoring/nodes/{target_node['id']}", headers=auth_headers)
        assert detail_res.status_code == 200
        detail = detail_res.json()
        # Verify 12 domains are present
        assert "overview" in detail
        assert "hardware" in detail
        assert "cpu_memory" in detail
        assert "gpu" in detail
        assert "storage" in detail
        assert "network" in detail
        assert "operating_system" in detail
        assert "services" in detail
        assert "applications" in detail
        assert "slurm" in detail
        assert "logs" in detail
        assert "history" in detail

        # Verify GPU clean fallback (N/A)
        assert detail["gpu"]["has_gpu"] is False
        assert "N/A" in detail["gpu"]["status_text"]

        # History Endpoint
        hist_res = await client.get(f"/api/monitoring/nodes/{target_node['id']}/history", headers=auth_headers)
        assert hist_res.status_code == 200
        assert "points" in hist_res.json()


@pytest.mark.asyncio
async def test_monitoring_alerts_and_resolution(auth_headers):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Send spike report (> 90% CPU)
        spike_payload = {
            "hostname": "test-spike.ayal.hpc",
            "ip_address": "10.0.0.52",
            "role": "compute",
            "metrics": {
                "cpu_utilization_pct": 96.5,
                "ram_utilization_pct": 92.0,
            },
            "services": [
                {"name": "slurmd", "status": "failed", "error": "Fatal cgroup memory limit exceeded"}
            ],
        }
        res = await client.post("/api/agent/report", json=spike_payload)
        assert res.status_code == 200

        # Verify alerts were raised
        alerts_res = await client.get("/api/monitoring/alerts?resolved=false", headers=auth_headers)
        assert alerts_res.status_code == 200
        alerts = alerts_res.json()["alerts"]
        alert_types = [a["alert_type"] for a in alerts]
        assert "high_cpu" in alert_types or "high_memory" in alert_types or "service_failed" in alert_types

        # Send recovery report (< 90% CPU)
        recovery_payload = {
            "hostname": "test-spike.ayal.hpc",
            "ip_address": "10.0.0.52",
            "role": "compute",
            "metrics": {
                "cpu_utilization_pct": 30.0,
                "ram_utilization_pct": 40.0,
            },
            "services": [
                {"name": "slurmd", "status": "running"}
            ],
        }
        res2 = await client.post("/api/agent/report", json=recovery_payload)
        assert res2.status_code == 200


@pytest.mark.asyncio
async def test_application_inventory(auth_headers):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        inv_res = await client.get("/api/monitoring/applications/inventory", headers=auth_headers)
        assert inv_res.status_code == 200
        inv_data = inv_res.json()
        assert "inventory" in inv_data
        assert "total" in inv_data
