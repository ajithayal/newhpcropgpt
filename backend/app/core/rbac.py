"""
RBAC (Role-Based Access Control) Service
-----------------------------------------
Manages permissions, roles, and checks.
"""
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from app.models.models import Permission, Role, user_roles_table, role_permissions_table


# Default permission set for the system
DEFAULT_PERMISSIONS = [
    # Nodes
    ("nodes.view", "View Nodes", "nodes", "View node list and details"),
    ("nodes.create", "Add Nodes", "nodes", "Add new nodes to the cluster"),
    ("nodes.edit", "Edit Nodes", "nodes", "Edit node configuration"),
    ("nodes.delete", "Remove Nodes", "nodes", "Remove nodes from the cluster"),
    ("nodes.manage", "Manage Node State", "nodes", "Enable/disable/maintenance/drain nodes"),
    # Jobs
    ("jobs.view", "View Jobs", "jobs", "View job list and details"),
    ("jobs.submit", "Submit Jobs", "jobs", "Submit new HPC jobs"),
    ("jobs.cancel", "Cancel Jobs", "jobs", "Cancel running/pending jobs"),
    ("jobs.manage", "Manage Jobs", "jobs", "Hold/release/requeue jobs"),
    # Storage
    ("storage.view", "View Storage", "storage", "View storage mounts and usage"),
    ("storage.manage", "Manage Storage", "storage", "Create/delete/modify storage mounts"),
    # Users
    ("users.view", "View Users", "users", "View user list and profiles"),
    ("users.create", "Create Users", "users", "Create new user accounts"),
    ("users.edit", "Edit Users", "users", "Edit user profiles and settings"),
    ("users.delete", "Delete Users", "users", "Delete user accounts"),
    ("users.manage_groups", "Manage Groups", "users", "Create/delete/modify user groups"),
    # Applications
    ("applications.view", "View Applications", "applications", "View application catalog"),
    ("applications.install", "Install Applications", "applications", "Install applications"),
    ("applications.manage", "Manage Applications", "applications", "Uninstall/enable/disable applications"),
    # Services
    ("services.view", "View Services", "services", "View service status"),
    ("services.manage", "Manage Services", "services", "Start/stop/restart services"),
    # Alerts
    ("alerts.view", "View Alerts", "alerts", "View alerts and incidents"),
    ("alerts.manage", "Manage Alerts", "alerts", "Acknowledge/resolve/assign alerts"),
    # Reports
    ("reports.view", "View Reports", "reports", "View utilization and usage reports"),
    ("reports.export", "Export Reports", "reports", "Export reports as CSV/PDF/Excel"),
    # Settings
    ("settings.view", "View Settings", "settings", "View system settings"),
    ("settings.manage", "Manage Settings", "settings", "Modify system settings"),
    # Licensing
    ("license.view", "View License", "license", "View license status"),
    ("license.manage", "Manage License", "license", "Manage license activation and renewal"),
    # Audit
    ("audit.view", "View Audit Logs", "audit", "View audit log entries"),
    # Notifications
    ("notifications.view", "View Notifications", "notifications", "View notifications"),
    ("notifications.manage", "Manage Notifications", "notifications", "Configure notification rules"),
    # Backup
    ("backup.view", "View Backups", "backup", "View backup history"),
    ("backup.manage", "Manage Backups", "backup", "Create/restore/delete backups"),
    # Cluster
    ("cluster.view", "View Cluster", "cluster", "View cluster information"),
    ("cluster.manage", "Manage Cluster", "cluster", "Manage cluster configuration"),
    # Partitions
    ("partitions.view", "View Partitions", "partitions", "View Slurm partitions"),
    ("partitions.manage", "Manage Partitions", "partitions", "Create/modify/delete partitions"),
    # Network
    ("network.view", "View Network", "network", "View network interfaces and traffic"),
    # Support
    ("support.view", "View Support Center", "support", "View support information"),
    ("support.manage", "Manage Support", "support", "Create/manage support tickets"),
]

# Default role → permission mappings
DEFAULT_ROLES = {
    "super_admin": [p[0] for p in DEFAULT_PERMISSIONS],  # all permissions
    "tenant_admin": [p[0] for p in DEFAULT_PERMISSIONS if p[0] != "license.manage"],
    "cluster_admin": [
        "nodes.view", "nodes.create", "nodes.edit", "nodes.manage",
        "jobs.view", "jobs.submit", "jobs.cancel", "jobs.manage",
        "storage.view", "storage.manage",
        "users.view", "users.create", "users.edit",
        "applications.view", "applications.install", "applications.manage",
        "services.view", "services.manage",
        "alerts.view", "alerts.manage",
        "reports.view", "reports.export",
        "settings.view",
        "audit.view",
        "notifications.view",
        "backup.view", "backup.manage",
        "cluster.view", "cluster.manage",
        "partitions.view", "partitions.manage",
        "network.view",
        "support.view", "support.manage",
    ],
    "operator": [
        "nodes.view", "nodes.manage",
        "jobs.view", "jobs.submit", "jobs.cancel",
        "storage.view",
        "users.view",
        "applications.view",
        "services.view", "services.manage",
        "alerts.view", "alerts.manage",
        "reports.view",
        "cluster.view",
        "partitions.view",
        "network.view",
        "support.view",
    ],
    "researcher": [
        "nodes.view",
        "jobs.view", "jobs.submit",
        "storage.view",
        "applications.view", "applications.install",
        "alerts.view",
        "reports.view",
        "cluster.view",
        "partitions.view",
        "support.view", "support.manage",
    ],
    "viewer": [
        "nodes.view",
        "jobs.view",
        "storage.view",
        "applications.view",
        "alerts.view",
        "reports.view",
        "cluster.view",
        "partitions.view",
        "network.view",
        "support.view",
    ],
}


class RBACService:

    @staticmethod
    async def seed_permissions(db: AsyncSession) -> None:
        result = await db.execute(select(Permission).limit(1))
        if result.scalar_one_or_none():
            return

        for codename, name, category, description in DEFAULT_PERMISSIONS:
            db.add(Permission(
                codename=codename,
                name=name,
                category=category,
                description=description,
            ))
        await db.commit()

    @staticmethod
    async def seed_roles(db: AsyncSession) -> None:
        result = await db.execute(select(Role).where(Role.is_system == True).limit(1))
        if result.scalar_one_or_none():
            return

        role_names = {
            "super_admin": ("Super Admin", "Full system access"),
            "tenant_admin": ("Tenant Admin", "Full tenant access except license management"),
            "cluster_admin": ("Cluster Admin", "Cluster and job management"),
            "operator": ("Operator", "Day-to-day operations"),
            "researcher": ("Researcher", "Job submission and resource viewing"),
            "viewer": ("Viewer", "Read-only access"),
        }

        for role_key, perms in DEFAULT_ROLES.items():
            display, desc = role_names[role_key]
            role = Role(
                name=role_key,
                display_name=display,
                description=desc,
                is_system=True,
                tenant_id=None,
            )
            db.add(role)
            await db.flush()

            for perm_code in perms:
                perm_result = await db.execute(
                    select(Permission).where(Permission.codename == perm_code)
                )
                perm = perm_result.scalar_one_or_none()
                if perm:
                    await db.execute(
                        role_permissions_table.insert().values(
                            role_id=role.id,
                            permission_id=perm.id,
                        )
                    )
        await db.commit()

    @staticmethod
    async def get_user_permissions(db: AsyncSession, user_id: UUID, tenant_id=None) -> set[str]:
        query = (
            select(Permission.codename)
            .join(role_permissions_table, role_permissions_table.c.permission_id == Permission.id)
            .join(user_roles_table, user_roles_table.c.role_id == role_permissions_table.c.role_id)
            .where(user_roles_table.c.user_id == user_id)
        )
        if tenant_id:
            query = query.where(user_roles_table.c.tenant_id == tenant_id)
        result = await db.execute(query)
        return {row[0] for row in result.all()}

    @staticmethod
    async def get_user_legacy_permissions(user_role: str) -> set[str]:
        """Map legacy enum-based roles to permission sets for backward compatibility."""
        return set(DEFAULT_ROLES.get(user_role, []))

    @staticmethod
    async def has_permission(db: AsyncSession, user_id: UUID, permission: str, tenant_id=None) -> bool:
        perms = await RBACService.get_user_permissions(db, user_id, tenant_id)
        if perms:
            return permission in perms
        return False

    @staticmethod
    async def get_role_by_name(db: AsyncSession, name: str, tenant_id=None) -> Optional[Role]:
        query = select(Role).where(Role.name == name)
        if tenant_id:
            query = query.where(Role.tenant_id == tenant_id)
        else:
            query = query.where(Role.tenant_id.is_(None))
        result = await db.execute(query)
        return result.scalar_one_or_none()

    @staticmethod
    async def check_permission(db: AsyncSession, user_id: UUID, permission: str, tenant_id=None):
        if not await RBACService.has_permission(db, user_id, permission, tenant_id):
            raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")
