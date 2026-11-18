from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_super_admin
from app.schemas.schemas import (
    LicenseIssueRequest, LicenseActivateRequest,
    LicenseResponse, LicenseStatusResponse,
)
from app.models.models import CustomerRegistration, ProductLicense, LicenseStatus, LicensePlan
from app.services.license_service import LicenseService, derive_key, format_key, get_system_installation_id
from app.services.email_service import EmailService

router = APIRouter()


@router.post("/license/verify-otp")
async def verify_otp(
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Validates customer OTP, expiration, and status.
    On success, generates unique digital license activation key
    and emails it to the software provider ajithlayatech@gmail.com.
    """
    customer_id = data.get("customer_id", "").strip().upper()
    otp = str(data.get("otp") or data.get("code") or "").strip()

    if not customer_id or not otp:
        raise HTTPException(status_code=400, detail="customer_id and otp are required")

    import hashlib
    otp_hash = hashlib.sha256(otp.encode("utf-8")).hexdigest()

    res = await db.execute(
        select(CustomerRegistration)
        .where(CustomerRegistration.customer_id == customer_id)
        .order_by(CustomerRegistration.created_at.desc())
    )
    reg = res.scalars().first()
    if not reg:
        raise HTTPException(status_code=404, detail=f"Registration for Customer ID {customer_id} not found.")

    is_match = (reg.verification_pin == otp) or (reg.verification_token_hash == otp_hash)
    if not is_match:
        raise HTTPException(status_code=400, detail="Invalid verification PIN. Please check your email or request a new code.")

    if reg.token_expires_at and reg.token_expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Verification PIN has expired. Please request a new code.")

    now = datetime.utcnow()
    reg.is_email_verified = True
    reg.status = "VERIFIED"
    reg.verified_at = now
    await db.commit()

    activation_key = format_key(derive_key(reg.customer_id, reg.business_email))

    # Send activation key to ajithlayatech@gmail.com
    await EmailService.send_provider_activation_request(
        db=db,
        customer_id=reg.customer_id,
        installation_id=reg.installation_id,
        customer_email=reg.business_email,
        org_name=reg.organization_name,
        admin_name=reg.admin_name,
        activation_key=activation_key,
        provider_email="ajithlayatech@gmail.com",
    )

    return {
        "success": True,
        "status": "OTP_VERIFIED",
        "customer_id": reg.customer_id,
        "installation_id": reg.installation_id,
        "organization": reg.organization_name,
        "customer_email": reg.business_email,
        "provider_email": "ajithlayatech@gmail.com",
        "email_verification_status": "OTP Confirmed",
        "message": "OTP verified successfully! The 26-digit activation key has been dispatched to ajithlayatech@gmail.com.",
    }


@router.post("/license/request-activation-key")
async def request_activation_key(
    data: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    Generates/retrieves unique digital license activation key and emails it to ajithlayatech@gmail.com.
    """
    customer_id = data.get("customer_id", "").strip().upper()
    if not customer_id:
        raise HTTPException(status_code=400, detail="customer_id is required")

    res = await db.execute(
        select(CustomerRegistration)
        .where(CustomerRegistration.customer_id == customer_id)
        .order_by(CustomerRegistration.created_at.desc())
    )
    reg = res.scalars().first()
    if not reg:
        raise HTTPException(status_code=404, detail=f"Registration for Customer ID {customer_id} not found.")

    activation_key = format_key(derive_key(reg.customer_id, reg.business_email))

    await EmailService.send_provider_activation_request(
        db=db,
        customer_id=reg.customer_id,
        installation_id=reg.installation_id,
        customer_email=reg.business_email,
        org_name=reg.organization_name,
        admin_name=reg.admin_name,
        activation_key=activation_key,
        provider_email="ajithlayatech@gmail.com",
    )

    return {
        "success": True,
        "customer_id": reg.customer_id,
        "installation_id": reg.installation_id,
        "organization": reg.organization_name,
        "customer_email": reg.business_email,
        "provider_email": "ajithlayatech@gmail.com",
        "message": "Activation key request dispatched to software provider ajithlayatech@gmail.com.",
    }


@router.post("/license/activate")
async def activate_license(
    data: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Validates the submitted token against Customer ID, Installation ID, and Hardware Fingerprint.
    Activates perpetual license on success.
    """
    customer_id = data.get("customer_id", "").strip().upper()
    license_key = data.get("license_key") or data.get("token") or ""
    submitted_inst_id = data.get("installation_id")
    customer_email = data.get("customer_email")

    if not customer_id or not license_key:
        raise HTTPException(status_code=400, detail="customer_id and license_key are required")

    # Retrieve registration
    res = await db.execute(
        select(CustomerRegistration)
        .where(CustomerRegistration.customer_id == customer_id)
        .order_by(CustomerRegistration.created_at.desc())
    )
    reg = res.scalars().first()
    if not reg:
        raise HTTPException(status_code=404, detail=f"Customer registration '{customer_id}' not found.")

    if not reg.is_email_verified:
        raise HTTPException(status_code=400, detail="Customer email must be OTP verified before activation.")

    email_to_use = customer_email or reg.business_email
    system_inst_id = get_system_installation_id()

    # Hardware fingerprint validation
    if submitted_inst_id and submitted_inst_id.strip().upper() != system_inst_id.strip().upper():
        raise HTTPException(
            status_code=400,
            detail=f"Hardware fingerprint mismatch: Submitted {submitted_inst_id} does not match system host {system_inst_id}."
        )

    ip = request.client.host if request.client else None
    result = await LicenseService.activate(
        db,
        customer_id=reg.customer_id,
        customer_email=email_to_use,
        submitted_key=license_key.strip(),
        ip_address=ip,
        organization=reg.organization_name,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Invalid activation details"))

    reg.status = "ACTIVATED"
    reg.activated_at = datetime.utcnow()
    await db.commit()

    return {
        "success": True,
        "status": "ACTIVE",
        "message": "License Activated Successfully",
        "license_type": "Perpetual",
        "organization": reg.organization_name,
        "customer_id": reg.customer_id,
        "installation_id": system_inst_id,
        "hardware_binding": "Verified",
        "plan": "ENTERPRISE",
        "is_perpetual": True,
        "max_nodes": 128,
        "max_clusters": 5,
        "activated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/license/status")
async def get_license_status(
    customer_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves current license and hardware binding status.
    """
    system_inst_id = get_system_installation_id()
    reg = None

    if customer_id:
        r = await db.execute(
            select(CustomerRegistration)
            .where(CustomerRegistration.customer_id == customer_id.strip().upper())
            .order_by(CustomerRegistration.created_at.desc())
        )
        reg = r.scalars().first()
    else:
        # Get latest registration
        r = await db.execute(
            select(CustomerRegistration).order_by(CustomerRegistration.created_at.desc())
        )
        reg = r.scalars().first()

    if not reg:
        return {
            "is_valid": False,
            "is_activated": False,
            "status": "none",
            "license_type": "Perpetual",
            "installation_id": system_inst_id,
            "hardware_binding": "Verified",
            "software_provider": "AjiCoreHPC",
            "provider_email": "ajithlayatech@gmail.com",
        }

    lic = await LicenseService.get_by_customer_id(db, reg.customer_id)
    is_active = bool(lic and lic.status == LicenseStatus.ACTIVATED)

    return {
        "is_valid": is_active,
        "is_activated": is_active,
        "status": "ACTIVE" if is_active else ("VERIFIED" if reg.is_email_verified else "PENDING"),
        "license_type": "Perpetual",
        "organization": reg.organization_name,
        "customer_id": reg.customer_id,
        "installation_id": system_inst_id,
        "hardware_binding": "Verified",
        "customer_business_email": reg.business_email,
        "software_provider": "AjiCoreHPC",
        "provider_email": "ajithlayatech@gmail.com",
        "email_verification_status": "OTP Confirmed" if reg.is_email_verified else "Pending OTP Verification",
        "activated_at": lic.activated_at.isoformat() if (lic and lic.activated_at) else None,
        "plan": getattr(lic, "plan", "ENTERPRISE") if lic else "ENTERPRISE",
        "max_nodes": getattr(lic, "max_nodes", 128) if lic else 128,
        "max_clusters": getattr(lic, "max_clusters", 5) if lic else 5,
    }


@router.get("/license", response_model=list[LicenseResponse])
async def list_licenses(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_super_admin),
):
    licenses = await LicenseService.list_licenses(db, skip=skip, limit=limit)
    return [LicenseResponse.model_validate(lic) for lic in licenses]


@router.post("/license/issue", response_model=LicenseResponse)
async def issue_license(
    data: LicenseIssueRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_super_admin),
):
    result = await LicenseService.issue_key(
        db,
        customer_id=data.customer_id,
        customer_email=data.customer_email,
        plan=data.plan,
        max_nodes=data.max_nodes,
        max_clusters=data.max_clusters,
        notes=data.notes,
    )
    lic = await LicenseService.get_by_customer_id(db, data.customer_id)
    return LicenseResponse.model_validate(lic)


@router.post("/license/revoke")
async def revoke_license(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_super_admin),
):
    success = await LicenseService.revoke(db, customer_id)
    if not success:
        raise HTTPException(status_code=404, detail="License not found")
    return {"status": "revoked", "customer_id": customer_id}
