"""
Services management API — start/stop/restart/logs with real systemd execution
Integrated with ServiceMonitor background polling engine.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from datetime import datetime
from typing import List, Dict, Any

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import Service, AuditLog
from app.services.service_monitor import ServiceMonitor

router = APIRouter()


@router.get("/services")
async def list_services(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Returns live service statuses from ServiceMonitor cache merged with database records.
    If no clusters are registered yet, returns empty list.
    """
    from app.models.models import Cluster
    clusters = (await db.execute(select(Cluster))).scalars().all()
    if not clusters:
        return []

    monitor = ServiceMonitor.get_instance()
    cache = monitor.services_cache

    # Query DB services
    query = select(Service).order_by(Service.name)
    if current_user.tenant_id:
        query = query.where(Service.tenant_id == current_user.tenant_id)
    result = await db.execute(query)
    db_services = result.scalars().all()

    # Match cache with DB records
    response_list = []
    for s in db_services:
        if s.name == "dcgm_exporter":
            continue  # Exclude GPU exporter on CPU cluster

        live_data = cache.get(s.name, {})
        status = live_data.get("status", s.status or "stopped")
        response_list.append({
            "id": str(s.id),
            "name": s.name,
            "display_name": s.display_name or live_data.get("display_name", s.name),
            "status": status,
            "version": s.version or "systemd",
            "type": "systemd",
            "node_hostname": s.node_hostname or live_data.get("node_hostname", "mas"),
            "unit": live_data.get("unit", s.name),
            "last_check": s.last_check.isoformat() if s.last_check else datetime.utcnow().isoformat(),
        })

    return response_list


@router.post("/services/{service_id_or_name}/start")
async def start_service(
    service_id_or_name: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Start service via real systemctl start on the remote node."""
    svc_name = await _resolve_service_name(db, service_id_or_name)
    monitor = ServiceMonitor.get_instance()
    try:
        res = await monitor.control_service(svc_name, "start")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start {svc_name}: {str(e)}")

    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="service_start", resource_type="service", resource_id=svc_name,
        details={"service": svc_name, "result": res},
    ))
    await db.commit()
    return res


@router.post("/services/{service_id_or_name}/stop")
async def stop_service(
    service_id_or_name: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Stop service via real systemctl stop on the remote node."""
    svc_name = await _resolve_service_name(db, service_id_or_name)
    monitor = ServiceMonitor.get_instance()
    try:
        res = await monitor.control_service(svc_name, "stop")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop {svc_name}: {str(e)}")

    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="service_stop", resource_type="service", resource_id=svc_name,
        details={"service": svc_name, "result": res},
    ))
    await db.commit()
    return res


@router.post("/services/{service_id_or_name}/restart")
async def restart_service(
    service_id_or_name: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Restart service via real systemctl restart on the remote node."""
    svc_name = await _resolve_service_name(db, service_id_or_name)
    monitor = ServiceMonitor.get_instance()
    try:
        res = await monitor.control_service(svc_name, "restart")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restart {svc_name}: {str(e)}")

    db.add(AuditLog(
        user_id=current_user.id, tenant_id=current_user.tenant_id,
        action="service_restart", resource_type="service", resource_id=svc_name,
        details={"service": svc_name, "result": res},
    ))
    await db.commit()
    return res


@router.post("/services/check")
async def check_services_now(
    current_user=Depends(get_current_user),
):
    """Force an immediate live probe of all cluster services."""
    monitor = ServiceMonitor.get_instance()
    results = await monitor.check_all_services()
    return {"status": "ok", "services": results}


async def _resolve_service_name(db: AsyncSession, identifier: str) -> str:
    """Helper to resolve either UUID or service name string."""
    try:
        uid = UUID(identifier)
        q = select(Service).where(Service.id == uid)
        svc = (await db.execute(q)).scalar_one_or_none()
        if svc:
            return svc.name
    except ValueError:
        pass

    # Check by name directly
    q = select(Service).where(Service.name == identifier)
    svc = (await db.execute(q)).scalar_one_or_none()
    if svc:
        return svc.name

    # If identifier matches in monitor cache
    monitor = ServiceMonitor.get_instance()
    if identifier in monitor.services_cache:
        return identifier

    raise HTTPException(status_code=404, detail=f"Service '{identifier}' not found")
