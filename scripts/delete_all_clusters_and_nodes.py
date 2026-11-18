import sqlite3
import os
import sys

DATABASES = [
    r"D:\AyalHPC\backend\ajicorehpc.db",
    r"D:\HPC Web application\layahpc\backend\ajicorehpc.db",
    r"D:\HPC Web application\ajicorehpc\backend\ajicorehpc.db",
]

TABLES_TO_PURGE = [
    "clusters",
    "nodes",
    "partitions",
    "hardware_inventories",
    "storage_mounts",
    "nfs_exports",
    "nfs_client_mounts",
    "file_shares",
    "hpc_jobs",
    "alerts",
    "node_metrics",
    "node_network_metrics",
    "node_storage_metrics",
    "node_gpu_metrics",
    "node_services",
    "node_applications",
    "slurm_metrics",
    "agent_status",
    "monitoring_alerts",
    "target_health",
    "operations",
    "operation_targets",
    "operation_approvals",
    "configuration_snapshots",
    "cluster_decommission_jobs",
    "node_decommission_jobs",
    "rollback_manifests",
    "rollback_operations",
    "cleanup_operations",
    "cleanup_operation_items",
    "package_inventory",
    "package_operations",
    "package_dependencies",
]

def purge_database(db_path: str):
    if not os.path.exists(db_path):
        print(f"[SKIP] Database not found at: {db_path}")
        return

    print(f"\n=======================================================")
    print(f"Purging Database: {db_path}")
    print(f"=======================================================")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    try:
        # Turn off foreign keys temporarily for clean mass truncation
        cur.execute("PRAGMA foreign_keys = OFF;")

        # Purge target tables
        for table in TABLES_TO_PURGE:
            try:
                cur.execute(f"SELECT count(*) FROM {table}")
                count = cur.fetchone()[0]
                if count > 0:
                    cur.execute(f"DELETE FROM {table}")
                    print(f"  [DELETED] {table}: {count} records removed.")
                else:
                    print(f"  [CLEAN]   {table}: 0 records.")
            except sqlite3.OperationalError:
                # Table might not exist in this database schema version
                pass

        # Reset SystemConfig state
        try:
            # Delete cluster deployment states and service configs
            cur.execute("DELETE FROM system_config WHERE key LIKE 'hpc_deploy_state_%'")
            cur.execute("DELETE FROM system_config WHERE key LIKE 'cluster_services_cfg_%'")
            cur.execute("DELETE FROM system_config WHERE key IN ('active_cluster_id', 'cluster_setup_state', 'cluster_setup_completed')")
            
            # Reset cluster name to empty JSON string '""'
            cur.execute("UPDATE system_config SET value='\"\"' WHERE key='cluster_name'")
            
            # Fix any empty strings in JSONB columns that cause JSONDecodeError
            cur.execute("UPDATE system_config SET value='\"\"' WHERE value=''")
            print("  [SUCCESS] system_config cluster states reset and JSON strings sanitized.")
        except Exception as e:
            print(f"  [WARN] system_config reset notice: {e}")

        # Add AuditLog record for the fresh reset
        try:
            import datetime
            import uuid
            cur.execute("""
                INSERT INTO audit_logs (id, action, resource_type, resource_id, details, result, ip_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                "FRESH_CONFIG_PURGE",
                "System",
                "all",
                '{"action": "Purged all clusters, nodes, partitions, and deployment states for fresh configuration", "actor": "system"}',
                "success",
                "127.0.0.1",
                datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            ))
            print("  [SUCCESS] AuditLog recorded for fresh configuration reset.")
        except Exception as e:
            print(f"  [WARN] AuditLog notice: {e}")

        conn.commit()
        cur.execute("PRAGMA foreign_keys = ON;")
        print(f"[COMPLETE] Database '{db_path}' purged and ready for fresh configuration.")

    finally:
        conn.close()

if __name__ == "__main__":
    for db_file in DATABASES:
        purge_database(db_file)
