"""
AjiCorehpc Manager — Power Sources Management API
Endpoints for:
1. Power Dashboard & Real-Time KPIs
2. Server PSU Monitoring & Live Hardware Diagnostics
3. UPS Device Management & SNMP Testing (v2c / v3)
4. BMC, Dell iDRAC, and HPE iLO Configuration & Controls
5. Battery Runtime Alerts & Thresholds
6. Graceful Automatic Shutdown Policies (Dry-Run & Execution)
7. Power Events & Audit History
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, AuditLog
from app.services.power_service import PowerService

router = APIRouter(prefix="/power", tags=["power"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class UpsConfigRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(..., description="UPS Name")
    manufacturer: Optional[str] = "APC / Schneider Electric"
    model: Optional[str] = "Smart-UPS SRT 3000VA RM"
    ip_address: str = Field(..., description="IP Address of UPS Management Card")
    snmp_version: Optional[str] = "v3"
    snmp_port: Optional[int] = 161
    community_v2: Optional[str] = "public"
    snmpv3_user: Optional[str] = "hpcpoweradmin"
    snmpv3_auth_proto: Optional[str] = "SHA256"
    snmpv3_auth_secret: Optional[str] = None
    snmpv3_priv_proto: Optional[str] = "AES"
    snmpv3_priv_secret: Optional[str] = None
    associated_nodes: Optional[List[str]] = []


class TestSnmpRequest(BaseModel):
    ip_address: str = Field(..., description="IP Address of UPS device")
    snmp_version: Optional[str] = "v3"
    snmp_port: Optional[int] = 161
    community_v2: Optional[str] = "public"
    snmpv3_user: Optional[str] = "hpcpoweradmin"
    snmpv3_auth_proto: Optional[str] = "SHA256"
    snmpv3_auth_secret: Optional[str] = None
    snmpv3_priv_proto: Optional[str] = "AES"
    snmpv3_priv_secret: Optional[str] = None


class BmcConfigRequest(BaseModel):
    id: Optional[str] = None
    node_hostname: str = Field(..., description="Host node")
    node_ip: str = Field(..., description="Host IP")
    bmc_type: Optional[str] = "Dell iDRAC 9"
    bmc_ip: str = Field(..., description="BMC / iDRAC IP")
    bmc_port: Optional[int] = 623
    username: Optional[str] = "root"
    password: Optional[str] = None
    auth_method: Optional[str] = "password"


class BmcActionRequest(BaseModel):
    action: str = Field(..., description="Action: 'power_on', 'power_cycle', 'graceful_reboot', 'power_off'")


class AlertRuleUpdateRequest(BaseModel):
    warning_threshold: int
    critical_threshold: int
    cooldown_seconds: Optional[int] = 300
    notify_channels: Optional[List[str]] = ["in_app", "email"]
    enabled: Optional[bool] = True


class ShutdownPolicyRequest(BaseModel):
    id: Optional[str] = None
    name: str
    target_ups_name: Optional[str] = "Rack 01 Primary UPS"
    associated_nodes: Optional[List[str]] = ["node", "mas"]
    trigger_runtime_min: Optional[int] = 10
    trigger_battery_pct: Optional[int] = 20
    require_consecutive_checks: Optional[int] = 3
    grace_period_sec: Optional[int] = 120
    shutdown_order: Optional[List[Dict[str, Any]]] = None
    dry_run_mode: Optional[bool] = True
    admin_approved: Optional[bool] = False
    enabled: Optional[bool] = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def get_power_dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns aggregated power dashboard metrics, charts, and hardware health."""
    return await PowerService.get_dashboard_summary(db)


@router.get("/psu")
async def get_server_psus(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns PSU health, wattage, efficiency, and redundancy status."""
    psus = await PowerService.get_server_psus(db)
    return {"psus": psus}


@router.get("/servers/psu-summary")
async def get_servers_psu_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns server-level PSU summary where each server is represented as a single circular entity."""
    servers = await PowerService.get_servers_psu_summary(db)
    return {"servers": servers}


@router.get("/servers/{server_id}/psus")
async def get_server_psus_detail(
    server_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns detailed individual PSU inventory for a specific server."""
    psus = await PowerService.get_server_psus_detail(db, server_id)
    return {"psus": psus}


@router.get("/servers/{server_id}/power-summary")
async def get_server_power_summary(
    server_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns server power capacity, consumption, headroom, and redundancy mode."""
    summary = await PowerService.get_server_power_summary(db, server_id)
    return {"summary": summary}


@router.post("/psu/refresh")
async def refresh_server_psus(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Triggers live hardware telemetry collection across cluster nodes."""
    return await PowerService.refresh_psu_telemetry(db)


@router.get("/ups")
async def get_ups_devices(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns all monitored UPS devices and SNMP status."""
    devices = await PowerService.get_ups_devices(db)
    return {"devices": devices}


@router.post("/ups")
async def save_ups_device(
    req: UpsConfigRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Creates or updates a UPS device configuration."""
    return await PowerService.save_ups_device(db, req.dict())


@router.delete("/ups/{ups_id}")
async def delete_ups_device(
    ups_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Deletes a UPS device."""
    return await PowerService.delete_ups_device(db, ups_id)


@router.post("/ups/test-snmp")
async def test_snmp_connectivity(
    req: TestSnmpRequest,
    user: User = Depends(require_admin),
):
    """Tests SNMP v2c / v3 communication with a target UPS device."""
    return await PowerService.test_snmp_connectivity(req.dict())


@router.get("/bmc")
async def get_bmc_devices(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns node BMC / iDRAC / iLO configurations."""
    devices = await PowerService.get_bmc_devices(db)
    return {"devices": devices}


@router.post("/bmc")
async def save_bmc_device(
    req: BmcConfigRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Saves or updates BMC configuration for a node."""
    return await PowerService.save_bmc_device(db, req.dict())


@router.post("/bmc/{bmc_id}/test")
async def test_bmc_connectivity(
    bmc_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Tests IPMI / Redfish connectivity to node BMC."""
    return await PowerService.test_bmc_connectivity(db, bmc_id)


@router.post("/bmc/{bmc_id}/action")
async def execute_bmc_power_action(
    bmc_id: str,
    req: BmcActionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Dispatches a chassis power control signal via BMC."""
    return await PowerService.execute_bmc_power_action(db, bmc_id, req.action)


@router.get("/alerts/rules")
async def get_alert_rules(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns power alert rules and configured thresholds."""
    rules = await PowerService.get_alert_rules(db)
    return {"rules": rules}


@router.put("/alerts/rules/{rule_id}")
async def update_alert_rule(
    rule_id: str,
    req: AlertRuleUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Updates thresholds for an alert rule."""
    return await PowerService.update_alert_rule(db, rule_id, req.dict())


@router.get("/shutdown/policies")
async def get_shutdown_policies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns automatic shutdown policies."""
    policies = await PowerService.get_shutdown_policies(db)
    return {"policies": policies}


@router.post("/shutdown/policies")
async def save_shutdown_policy(
    req: ShutdownPolicyRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Saves or updates a shutdown policy."""
    return await PowerService.save_shutdown_policy(db, req.dict())


@router.post("/shutdown/policies/{policy_id}/dry-run")
async def dry_run_shutdown_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Executes a dry-run test of the shutdown sequence."""
    return await PowerService.execute_shutdown_policy(db, policy_id, dry_run=True)


@router.post("/shutdown/policies/{policy_id}/execute")
async def execute_shutdown_policy_live(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Executes live shutdown sequence."""
    return await PowerService.execute_shutdown_policy(db, policy_id, dry_run=False)


@router.get("/events")
async def get_power_events(
    limit: int = Query(50, ge=1, le=500),
    severity: Optional[str] = Query("all"),
    device_type: Optional[str] = Query("all"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns power events with optional filtering."""
    events = await PowerService.get_events(db, limit, severity, device_type)
    return {"events": events}


@router.get("/events/export")
async def export_power_events_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Exports power events as a CSV stream."""
    events = await PowerService.get_events(db, limit=500)
    lines = ["Timestamp,Device,Device Type,Event,Severity,Condition,Previous State,Current State"]
    for e in events:
        lines.append(
            f'"{e["created_at"]}","{e["device_name"]}","{e["device_type"]}","{e["event_type"]}","{e["severity"]}","{e["trigger_condition"]}","{e["previous_state"]}","{e["current_state"]}"'
        )
    csv_content = "\n".join(lines)
    return PlainTextResponse(content=csv_content, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=power_events.csv"})
