from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_super_admin
from app.schemas.schemas import (
    BrandingUpdate, ClusterConfigUpdate,
    FreeIPAConfig, AuditLogResponse, NotificationResponse,
    TenantCreate, TenantResponse,
    AlertResponse, ServiceResponse,
)
from app.services.setup_service import SetupService

router = APIRouter()


@router.get("/settings/branding")
async def get_branding(db: AsyncSession = Depends(get_db)):
    config = await SetupService.get_all_config(db)
    return {
        "brand_name": config.get("brand_name", "AYAL HPC"),
        "logo_path": config.get("logo_path"),
        "support_email": config.get("support_email"),
        "support_phone": config.get("support_phone"),
        "support_website": config.get("support_website"),
        "theme_color": config.get("theme_color", "#1677ff"),
    }


@router.put("/settings/branding")
async def update_branding(
    data: BrandingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    for key, value in data.model_dump(exclude_unset=True).items():
        await SetupService.set_config(db, key, value, current_user.tenant_id)
    return {"status": "updated"}


@router.get("/settings/cluster")
async def get_cluster_config(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    config = await SetupService.get_all_config(db, current_user.tenant_id)
    return {
        "cluster_name": config.get("cluster_name", "AYAL HPC Cluster"),
        "timezone": config.get("timezone", "UTC"),
        "install_path": config.get("install_path", "/opt/ayalhpc"),
    }


@router.put("/settings/cluster")
async def update_cluster_config(
    data: ClusterConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    for key, value in data.model_dump(exclude_unset=True).items():
        await SetupService.set_config(db, key, value, current_user.tenant_id)
    return {"status": "updated"}


@router.get("/settings/freeipa")
async def get_freeipa_config(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    config = await SetupService.get_all_config(db, current_user.tenant_id)
    return {
        "ldap_url": config.get("freeipa_ldap_url", ""),
        "base_dn": config.get("freeipa_base_dn", ""),
        "bind_dn": config.get("freeipa_bind_dn", ""),
        "kerberos_realm": config.get("freeipa_kerberos_realm", ""),
        "sync_interval_minutes": config.get("freeipa_sync_interval", 30),
        "configured": bool(config.get("freeipa_ldap_url")),
    }


@router.put("/settings/freeipa")
async def update_freeipa_config(
    data: FreeIPAConfig,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    configs = {
        "freeipa_ldap_url": data.ldap_url,
        "freeipa_base_dn": data.base_dn,
        "freeipa_bind_dn": data.bind_dn,
        "freeipa_bind_password": data.bind_password,
        "freeipa_ca_cert_path": data.ca_cert_path,
        "freeipa_kerberos_realm": data.kerberos_realm,
        "freeipa_sync_interval": data.sync_interval_minutes,
    }
    for key, value in configs.items():
        await SetupService.set_config(db, key, value, current_user.tenant_id)
    return {"status": "updated"}


@router.post("/settings/freeipa/test")
async def test_freeipa_connection(
    data: FreeIPAConfig,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    try:
        import ldap
        conn = ldap.initialize(data.ldap_url)
        conn.simple_bind_s(data.bind_dn, data.bind_password)
        conn.unbind_s()
        return {"status": "connected", "message": "FreeIPA connection successful"}
    except Exception as e:
        return {"status": "failed", "message": str(e)}


@router.get("/audit-logs")
async def get_audit_logs(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    from app.models.models import AuditLog
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if current_user.tenant_id:
        query = query.where(AuditLog.tenant_id == current_user.tenant_id)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    logs = result.scalars().all()
    return [AuditLogResponse.model_validate(log) for log in logs]


@router.get("/notifications")
async def get_notifications(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import Notification
    query = select(Notification).where(Notification.user_id == current_user.id)
    if current_user.tenant_id:
        query = query.where(Notification.tenant_id == current_user.tenant_id)
    query = query.order_by(Notification.created_at.desc()).limit(50)
    result = await db.execute(query)
    return [NotificationResponse.model_validate(n) for n in result.scalars().all()]


@router.get("/stats/overview")
async def get_overview_stats(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    from app.models.models import User, Node, HpcJob, Package, Ticket
    from sqlalchemy import func

    tenant_filter = []
    if current_user.tenant_id:
        tenant_filter = [Node.tenant_id == current_user.tenant_id]

    user_count = (await db.execute(
        select(func.count(User.id)).where(User.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(User.id))
    )).scalar()
    node_count = (await db.execute(
        select(func.count(Node.id)).where(*tenant_filter) if tenant_filter else select(func.count(Node.id))
    )).scalar()
    job_count = (await db.execute(
        select(func.count(HpcJob.id)).where(HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id))
    )).scalar()
    package_count = (await db.execute(select(func.count(Package.id)))).scalar()
    ticket_count = (await db.execute(
        select(func.count(Ticket.id)).where(Ticket.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(Ticket.id))
    )).scalar()
    active_jobs = (await db.execute(
        select(func.count(HpcJob.id)).where(HpcJob.state == "running").where(HpcJob.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(HpcJob.id)).where(HpcJob.state == "running")
    )).scalar()

    return {
        "total_users": user_count or 0,
        "total_nodes": node_count or 0,
        "total_jobs": job_count or 0,
        "active_jobs": active_jobs or 0,
        "total_packages": package_count or 0,
        "open_tickets": ticket_count or 0,
    }


# --- Tenants (super admin only) ---

@router.get("/tenants", response_model=list[TenantResponse])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_super_admin),
):
    from app.models.models import Tenant
    result = await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))
    return [TenantResponse.model_validate(t) for t in result.scalars().all()]


# --- Alerts ---

@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts(
    skip: int = 0,
    limit: int = 100,
    level: str = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import Alert, Cluster
    clusters = (await db.execute(select(Cluster))).scalars().all()
    query = select(Alert).order_by(Alert.created_at.desc())
    # When no clusters are registered, never return service health alerts
    if not clusters:
        query = query.where(Alert.category != "Service Health")
    if current_user.tenant_id:
        query = query.where((Alert.tenant_id == current_user.tenant_id) | (Alert.tenant_id.is_(None)))
    if level:
        query = query.where(Alert.level == level)
    query = query.offset(skip).limit(limit)
    result = await db.execute(query)
    return [AlertResponse.model_validate(a) for a in result.scalars().all()]


@router.put("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import Alert
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_acknowledged = True
    alert.acknowledged_by = current_user.id
    alert.acknowledged_at = datetime.utcnow()
    await db.commit()
    return {"status": "acknowledged"}


@router.put("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import Alert
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_resolved = True
    alert.resolved_at = datetime.utcnow()
    await db.commit()
    return {"status": "resolved"}


@router.post("/alerts/acknowledge-all")
async def acknowledge_all_alerts(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import Alert
    query = select(Alert).where(Alert.is_acknowledged == False)
    if current_user.tenant_id:
        query = query.where(Alert.tenant_id == current_user.tenant_id)
    result = await db.execute(query)
    alerts = result.scalars().all()
    now = datetime.utcnow()
    for a in alerts:
        a.is_acknowledged = True
        a.acknowledged_by = current_user.id
        a.acknowledged_at = now
    await db.commit()
    return {"status": "all_acknowledged", "count": len(alerts)}


@router.post("/alerts/resolve-all")
async def resolve_all_alerts(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import Alert
    query = select(Alert).where(Alert.is_resolved == False)
    if current_user.tenant_id:
        query = query.where(Alert.tenant_id == current_user.tenant_id)
    result = await db.execute(query)
    alerts = result.scalars().all()
    now = datetime.utcnow()
    for a in alerts:
        a.is_resolved = True
        a.resolved_at = now
    await db.commit()
    return {"status": "all_resolved", "count": len(alerts)}

# ---------------------------------------------------------------------------
# Roles Management (BUG-16)
# ---------------------------------------------------------------------------

@router.get("/roles")
@router.get("/admin/roles")
async def list_roles(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List all available system roles."""
    from app.models.models import Role
    result = await db.execute(select(Role).order_by(Role.name))
    roles = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "display_name": r.display_name or r.name.replace("_", " ").title(),
            "description": r.description or "",
            "is_system": bool(r.is_system),
        }
        for r in roles
    ]

