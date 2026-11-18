"""
AjiCorehpc Manager — Identity, FreeIPA, User Provisioning & Shared Storage API
Endpoints for:
1. FreeIPA Server Configuration & Connectivity Testing
2. FreeIPA Client Node Enrollment
3. Shared Storage Discovery (/home, /apps, /scratch, NFS mounts)
4. Home Directory Path Validation
5. 6-Stage Guided User Provisioning
6. Storage Quota Inspection & Enforcement
7. HPC User Groups Management
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from uuid import UUID
import uuid
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_super_admin
from app.models.models import User, Group, AuditLog, SystemConfig, Node
from app.services.freeipa_service import FreeIPAService

router = APIRouter(prefix="/identity", tags=["identity"])


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class FreeIPAConfigRequest(BaseModel):
    server_fqdn: str = Field(..., description="IPA server FQDN (e.g. master.cluster.local)")
    server_ip: str = Field(..., description="IPA server IP")
    domain: str = Field("cluster.local", description="IPA domain")
    realm: str = Field("CLUSTER.LOCAL", description="Kerberos realm")
    admin_user: str = Field("admin", description="Administrative username")
    admin_password: Optional[str] = Field(None, description="Administrative password")
    ldap_url: Optional[str] = Field(None)
    ldaps_url: Optional[str] = Field(None)
    base_dn: Optional[str] = Field(None)
    bind_dn: Optional[str] = Field(None)
    ca_cert_path: Optional[str] = Field("/etc/ipa/ca.crt")


class EnrollClientRequest(BaseModel):
    node_ip: str
    hostname: str
    domain: Optional[str] = "cluster.local"
    realm: Optional[str] = "CLUSTER.LOCAL"
    server_ip: Optional[str] = None
    admin_user: Optional[str] = "admin"
    admin_password: Optional[str] = None


class ValidatePathRequest(BaseModel):
    shared_storage_path: str
    proposed_folder: str


class ProvisionFolderItem(BaseModel):
    storage_path: str = Field(..., description="Shared storage mount point, e.g. /home, /scratch")
    folder_name: str = Field(..., description="Folder name, e.g. tamil, tamil-scratch")
    full_path: str = Field(..., description="Full path, e.g. /home/tamil")
    purpose: Optional[str] = Field("Primary Home Directory", description="Folder purpose")
    is_primary_home: Optional[bool] = Field(False, description="Whether this is the user's primary POSIX home")
    quota_soft_gb: Optional[int] = Field(50, description="Soft limit in GB")
    quota_hard_gb: Optional[int] = Field(100, description="Hard limit in GB")
    quota_domain: Optional[str] = Field("user", description="Quota domain: user or project")


class ProvisionUserRequest(BaseModel):
    username: str
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    email: Optional[str] = None
    employee_id: Optional[str] = ""
    password: Optional[str] = "AjiCorehpc@2026"
    role: Optional[str] = "researcher"
    shell: Optional[str] = "/bin/bash"
    group: Optional[str] = "researchers"
    status: Optional[str] = "Active"
    shared_storage: Optional[str] = "/home"
    home_directory: Optional[str] = None
    quota_soft_gb: Optional[int] = 50
    quota_hard_gb: Optional[int] = 100
    quota_unit: Optional[str] = "GiB"
    inode_limit: Optional[int] = 1000000
    folders: Optional[List[ProvisionFolderItem]] = None
    selected_storage_ids: Optional[List[str]] = None


class QuotaUpdateRequest(BaseModel):
    soft_limit_gb: int
    hard_limit_gb: int


class GroupCreateRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    freeipa_gid: Optional[int] = None
    quota_storage_gb: int = 1000
    quota_core_hours: int = 10000


# ---------------------------------------------------------------------------
# 1. FreeIPA Server Configuration & Testing
# ---------------------------------------------------------------------------

@router.get("/freeipa/config")
async def get_freeipa_server_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve current FreeIPA server settings and health status."""
    return await FreeIPAService.get_server_config(db, current_user.tenant_id)


@router.put("/freeipa/config")
async def update_freeipa_server_config(
    data: FreeIPAConfigRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update FreeIPA server configuration."""
    updated = await FreeIPAService.update_server_config(db, data.model_dump(), current_user.tenant_id)
    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="freeipa_config_update", resource_type="freeipa",
        details={"server_fqdn": data.server_fqdn, "domain": data.domain, "realm": data.realm}
    ))
    await db.commit()
    return updated


@router.post("/freeipa/test")
async def test_freeipa_connectivity(
    payload: Dict[str, Any],
    current_user: User = Depends(require_admin),
):
    """Run comprehensive DNS, Chrony, Kerberos, LDAP, and authentication tests."""
    return FreeIPAService.test_server_connectivity(payload)


# ---------------------------------------------------------------------------
# 2. Client Installation & Enrollment
# ---------------------------------------------------------------------------

@router.get("/freeipa/nodes")
async def list_freeipa_nodes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List cluster nodes and their FreeIPA SSSD enrollment status."""
    return await FreeIPAService.get_enrolled_nodes(db)


@router.post("/freeipa/enroll")
async def enroll_freeipa_client(
    data: EnrollClientRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Execute 9-step client enrollment workflow on the target Linux/HPC node."""
    res = FreeIPAService.enroll_client_node(data.model_dump())
    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="freeipa_client_enroll", resource_type="node",
        details={"hostname": data.hostname, "ip": data.node_ip, "status": res.get("status")}
    ))
    await db.commit()
    return res


# ---------------------------------------------------------------------------
# 3. Shared Storage Discovery & Path Validation
# ---------------------------------------------------------------------------

@router.get("/storage/discover")
async def discover_shared_storage(
    node_ip: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Introspect real filesystems, capacity, RW state, and quota support across nodes."""
    target_ip = node_ip
    if not target_ip:
        mn_q = await db.execute(select(Node).where(Node.node_type == "master").limit(1))
        mn = mn_q.scalar_one_or_none()
        if mn:
            target_ip = mn.address or mn.management_ip
    return FreeIPAService.discover_shared_storage(node_ip=target_ip or "")


@router.post("/storage/validate-path")
async def validate_home_path(
    data: ValidatePathRequest,
    current_user: User = Depends(get_current_user),
):
    """Validate that proposed user home directory is secure, non-traversing, and inside approved root."""
    return FreeIPAService.validate_home_path(data.shared_storage_path, data.proposed_folder)


# ---------------------------------------------------------------------------
# 4. User Provisioning (6-Stage Guided Workflow)
# ---------------------------------------------------------------------------

@router.post("/users/provision")
async def provision_user(
    data: ProvisionUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Execute 6-step guided user provisioning:
    1. Validate account details & ensure no duplicates
    2. Create FreeIPA authoritative account
    3. Retrieve authoritative UID/GID
    4. Create home directory on confirmed shared storage
    5. Set permissions (0700) and ownership
    6. Apply XFS filesystem quota
    """
    try:
        return await FreeIPAService.provision_user(
            db=db,
            payload=data.model_dump(),
            admin_user_id=current_user.id,
            tenant_id=current_user.tenant_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Provisioning failed: {str(e)}")


@router.put("/users/provision/{user_id}")
async def update_provisioned_user(
    user_id: UUID,
    data: ProvisionUserRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Execute full update of an existing provisioned user:
    1. Update account details, password (if provided), shell, role, group
    2. Sync FreeIPA / Linux credentials on master node
    3. Ensure home directory permissions & path
    4. Apply updated XFS filesystem quota (xfs_quota)
    5. Return verification logs and status
    """
    try:
        return await FreeIPAService.update_provisioned_user(
            db=db,
            user_id=user_id,
            payload=data.model_dump(),
            admin_user_id=current_user.id,
            tenant_id=current_user.tenant_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"User update failed: {str(e)}")


# ---------------------------------------------------------------------------
# 5. Storage Quotas Inspection & Enforcement
# ---------------------------------------------------------------------------

@router.get("/quotas")
async def get_storage_quotas(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all user storage quotas, limits, real usage, and enforcement status."""
    return await FreeIPAService.get_storage_quotas(db, current_user.tenant_id)


@router.put("/quotas/{user_id}")
async def update_user_quota(
    user_id: UUID,
    data: QuotaUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update soft and hard storage quota for a user on disk and database."""
    try:
        return await FreeIPAService.update_user_quota(
            db=db,
            user_id=user_id,
            soft_gb=data.soft_limit_gb,
            hard_gb=data.hard_limit_gb,
            admin_user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/users/{user_id}/verify-repair-quota")
async def verify_and_repair_quota(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Verify and repair storage quota for a user:
    1. Inspects effective filesystem quota (xfs_quota) vs configured DB limit
    2. Validates kernel quota enforcement state (Accounting: ON, Enforcement: ON)
    3. Auto-repairs missing or desynced limits without truncating user files
    4. Checks write blocking and data preservation
    5. Verifies multi-node UID synchronization
    """
    try:
        return await FreeIPAService.verify_and_repair_quota(
            db=db,
            user_id=user_id,
            admin_user_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quota verification failed: {str(e)}")


# ---------------------------------------------------------------------------
# 6. User Groups Management
# ---------------------------------------------------------------------------

@router.get("/groups")
async def list_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List HPC user groups with eager-loaded user associations."""
    q = select(Group).options(selectinload(Group.users)).order_by(Group.name)
    if current_user.tenant_id:
        q = q.where((Group.tenant_id == current_user.tenant_id) | (Group.tenant_id.is_(None)))
    r = await db.execute(q)
    groups = r.scalars().all()

    # If no groups in DB, provide standard HPC groups
    if not groups:
        default_groups = [
            Group(name="researchers", description="Primary computational science researchers and faculty", freeipa_gid=10001, quota_storage_gb=500, quota_core_hours=50000, tenant_id=current_user.tenant_id),
            Group(name="engineers", description="Infrastructure engineers and pipeline developers", freeipa_gid=10002, quota_storage_gb=1000, quota_core_hours=100000, tenant_id=current_user.tenant_id),
            Group(name="students", description="Academic lab students with standard batch quotas", freeipa_gid=10003, quota_storage_gb=100, quota_core_hours=5000, tenant_id=current_user.tenant_id),
            Group(name="admins", description="HPC cluster systems administrators", freeipa_gid=10000, quota_storage_gb=2000, quota_core_hours=500000, tenant_id=current_user.tenant_id),
        ]
        for g in default_groups:
            db.add(g)
        await db.commit()
        r2 = await db.execute(select(Group).options(selectinload(Group.users)).order_by(Group.name))
        groups = r2.scalars().all()

    return [
        {
            "id": str(g.id),
            "name": g.name,
            "description": g.description or "",
            "freeipa_gid": g.freeipa_gid,
            "quota_storage_gb": g.quota_storage_gb or 0,
            "quota_core_hours": g.quota_core_hours or 0,
            "member_count": len(g.users) if g.users else 0,
        }
        for g in groups
    ]
@router.post("/groups")
async def create_group(
    data: GroupCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new HPC user group."""
    existing = await db.execute(select(Group).where(Group.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Group '{data.name}' already exists")

    gid = data.freeipa_gid or (10000 + len((await db.execute(select(Group))).scalars().all()) + 1)
    group = Group(
        name=data.name,
        description=data.description,
        freeipa_gid=gid,
        quota_storage_gb=data.quota_storage_gb,
        quota_core_hours=data.quota_core_hours,
        tenant_id=current_user.tenant_id,
    )
    db.add(group)
    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="group_create", resource_type="group",
        details={"name": data.name, "gid": gid}
    ))
    await db.commit()
    await db.refresh(group)
    return {
        "id": str(group.id), "name": group.name, "description": group.description,
        "freeipa_gid": group.freeipa_gid, "quota_storage_gb": group.quota_storage_gb,
        "quota_core_hours": group.quota_core_hours,
    }
