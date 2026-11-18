import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.database import async_session
from app.core.security import get_password_hash
from app.models.models import (
    User, Node, Cluster, PackageInventory, ConfigurationSnapshot,
    OperationTarget, Operation, SystemConfig,
    NodeMetric, NodeNetworkMetric, NodeStorageMetric, NodeGpuMetric,
    NodeServiceStatus, NodeApplication, SlurmClusterMetric, AgentStatus,
    MonitoringAlert, TargetHealth
)
from app.services.node_monitor import NodeMonitorService
from app.services.user_service import UserService
from sqlalchemy import select, delete


async def main():
    async with async_session() as db:
        # 1. Update Administrator password to Aji@557
        users = (await db.execute(select(User))).scalars().all()
        for u in users:
            if u.username.lower() == "admin":
                u.hashed_password = get_password_hash("Aji@557")
                print(f"Updated password for administrator '{u.username}' to 'Aji@557'")

        # 2. Update SystemConfig for default administrator
        configs = (await db.execute(select(SystemConfig))).scalars().all()
        for c in configs:
            if c.key == "pending_admin_username":
                c.value = "admin"
            elif c.key == "pending_admin_password":
                c.value = "Aji@557"
            elif c.key.startswith("cluster_services_cfg_"):
                await db.delete(c)
                print(f"Deleted SystemConfig: {c.key}")
            elif c.key == "cluster_name":
                c.value = ""
                print("Reset cluster_name in SystemConfig")
            elif c.key in ["freeipa_server_ip", "freeipa_server_fqdn", "freeipa_realm", "freeipa_domain"]:
                c.value = ""
                print(f"Reset {c.key} in SystemConfig")

        # 3. Clean up associated cluster/node telemetry and operation records
        pkg_cnt = len((await db.execute(select(PackageInventory))).scalars().all())
        await db.execute(delete(PackageInventory))
        print(f"Deleted {pkg_cnt} PackageInventory records")

        snap_cnt = len((await db.execute(select(ConfigurationSnapshot))).scalars().all())
        await db.execute(delete(ConfigurationSnapshot))
        print(f"Deleted {snap_cnt} ConfigurationSnapshot records")

        ot_cnt = len((await db.execute(select(OperationTarget))).scalars().all())
        await db.execute(delete(OperationTarget))
        print(f"Deleted {ot_cnt} OperationTarget records")

        op_cnt = len((await db.execute(select(Operation))).scalars().all())
        await db.execute(delete(Operation))
        print(f"Deleted {op_cnt} Operation records")

        # 3b. Delete Live Telemetry & Monitoring Records
        await db.execute(delete(NodeMetric))
        await db.execute(delete(NodeNetworkMetric))
        await db.execute(delete(NodeStorageMetric))
        await db.execute(delete(NodeGpuMetric))
        await db.execute(delete(NodeServiceStatus))
        await db.execute(delete(NodeApplication))
        await db.execute(delete(SlurmClusterMetric))
        await db.execute(delete(AgentStatus))
        await db.execute(delete(MonitoringAlert))
        await db.execute(delete(TargetHealth))
        print("Cleared all node telemetry, metrics, services, apps, alerts, and target health tables.")

        # 4. Delete All Registered Cluster Nodes
        nodes = (await db.execute(select(Node))).scalars().all()
        for n in nodes:
            print(f"Deleting Node: {n.hostname} (IP: {n.address})")
            await db.delete(n)

        # 5. Delete Cluster(s)
        clusters = (await db.execute(select(Cluster))).scalars().all()
        for cl in clusters:
            print(f"Deleting Cluster: {cl.name} (ID: {cl.id})")
            await db.delete(cl)

        await db.commit()
        print("Database commit successful.")

    # 6. Clear NodeMonitor in-memory telemetry cache
    monitor = NodeMonitorService.get_instance()
    monitor.telemetry_cache.clear()
    print("NodeMonitor telemetry cache cleared.")

    # 7. Verification of authentication
    async with async_session() as db:
        res1 = await UserService.authenticate(db, "admin", "Aji@557")
        res2 = await UserService.authenticate(db, "Admin", "Aji@557")
        print(f"Auth verification: 'admin': {bool(res1)}, 'Admin': {bool(res2)}")
        
        remaining_nodes = (await db.execute(select(Node))).scalars().all()
        remaining_clusters = (await db.execute(select(Cluster))).scalars().all()
        print(f"Remaining nodes in DB: {len(remaining_nodes)}")
        print(f"Remaining clusters in DB: {len(remaining_clusters)}")


if __name__ == "__main__":
    asyncio.run(main())
