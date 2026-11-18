"""
AjiCorehpc Manager — BMC / iDRAC / iLO Hardware Management API
Endpoints for:
1. Server BMC / iDRAC / iLO Registration & Connection Management
2. 3-Stage Connection, Authentication & Capability Discovery Engine
3. Deep Hardware Inventory Normalization (System, CPU, Memory, Storage, Power/Thermal, Network)
4. Hardware Inventory Refresh & Audit History
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User
from app.services.hardware_service import HardwareService

router = APIRouter(prefix="/bmc", tags=["bmc"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ValidateAndDiscoverRequest(BaseModel):
    server_name: Optional[str] = "Compute Node"
    hostname: str = Field(..., description="Registered node hostname")
    controller_type: str = Field("Dell iDRAC", description="Generic BMC, Dell iDRAC, or HPE iLO")
    bmc_ip: str = Field(..., description="Management controller IP")
    port: Optional[int] = Field(443, description="Default HTTPS 443 / IPMI 623")
    username: str = Field(..., description="Management controller username")
    password: Optional[str] = Field(None, description="Management controller password")
    protocol: Optional[str] = Field("Redfish", description="Redfish, IPMI, or Vendor REST")
    tls_verify: Optional[bool] = Field(True, description="Enforce TLS certificate validation")


class SaveServerRequest(BaseModel):
    id: Optional[str] = None
    server_name: str
    hostname: str
    node_ip: str
    controller_type: str = "Dell iDRAC"
    bmc_ip: str
    port: Optional[int] = 443
    username: str
    password: Optional[str] = None
    protocol: Optional[str] = "Redfish"
    tls_verify: Optional[bool] = True
    firmware_version: Optional[str] = "v6.10.30.00"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/servers")
async def get_servers(
    controller_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns all registered BMC, iDRAC, and iLO servers."""
    servers = await HardwareService.get_servers(db, controller_filter=controller_type)
    return {"servers": servers}


@router.post("/validate-and-discover")
async def validate_and_discover(
    req: ValidateAndDiscoverRequest,
    user: User = Depends(require_admin),
):
    """
    3-Stage Connection, Authentication, Protocol Detection & Capability Discovery.
    Validates network, tests credentials, discovers Redfish/IPMI resources and builds capability profile.
    """
    res = await HardwareService.validate_and_discover(req.dict())
    if not res.get("success"):
        raise HTTPException(
            status_code=400,
            detail=res.get("error", "Validation or authentication failed.")
        )
    return res


@router.post("/servers")
async def save_server(
    req: SaveServerRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Saves or updates a server controller configuration after successful validation."""
    return await HardwareService.save_server(db, req.dict())


@router.delete("/servers/{server_id}")
async def delete_server(
    server_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Removes a registered BMC server."""
    return await HardwareService.delete_server(db, server_id)


@router.get("/servers/{server_id}/inventory")
async def get_server_inventory(
    server_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns normalized hardware inventory for a specific server."""
    inv = await HardwareService.get_inventory(db, server_id=server_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Inventory not found for this server.")
    return {"inventory": inv}


@router.post("/servers/{server_id}/refresh-inventory")
async def refresh_server_inventory(
    server_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Refreshes complete hardware inventory from real hardware sensors."""
    return await HardwareService.refresh_inventory(db, server_id)


@router.get("/inventory")
async def get_all_inventory(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns hardware inventory across all cluster servers."""
    inventories = await HardwareService.get_all_inventories(db)
    return {"inventories": inventories}


@router.get("/history")
async def get_connection_history(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns connection and authentication audit history log."""
    history = await HardwareService.get_history(db, limit=limit)
    return {"history": history}
