from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.schemas import (
    SetupRequest, SetupStatus, LoginRequest, TokenResponse, UserResponse,
    SmtpTestRequest, CustomerRegisterRequest, EmailConfirmRequest,
    LicenseActivateWizardRequest, FinalizeAdminRequest,
    ResendOtpRequest, InstallTaskRequest, FinalizeSystemRequest,
    ForgotPasswordRequest, ForgotPasswordVerifyOtpRequest, ForgotPasswordResetRequest,
)
from app.services.setup_service import SetupService
from app.services.user_service import UserService
from app.services.license_service import LicenseService
from app.services.email_service import EmailService

router = APIRouter()


@router.get("/setup/status", response_model=SetupStatus)
async def get_setup_status(db: AsyncSession = Depends(get_db)):
    is_configured = await SetupService.is_configured(db)
    license_valid = False
    if is_configured:
        tenant_id = await SetupService.get_tenant_id_from_config(db)
        if tenant_id:
            license_valid = await LicenseService.is_license_valid_for_tenant(db, tenant_id)
    return SetupStatus(
        is_configured=is_configured,
        admin_exists=is_configured,
        license_activated=license_valid,
    )


@router.get("/setup/system-info")
async def get_system_info():
    """Returns stable host installation ID for licensing."""
    return SetupService.get_system_info()


@router.get("/setup/smtp/status")
async def get_smtp_status(db: AsyncSession = Depends(get_db)):
    """Returns active SMTP configuration and verification state."""
    cfg = await EmailService.get_smtp_config(db)
    user = cfg.get("user", "")
    masked_user = user
    if "@" in user:
        p = user.split("@")
        masked_user = p[0][:2] + "***@" + p[1]
    return {
        "configured": cfg.get("verified", True),
        "host": cfg.get("host", "smtp.gmail.com"),
        "port": cfg.get("port", 587),
        "encryption": "STARTTLS",
        "sender_masked": masked_user,
        "provider": cfg.get("provider", "Gmail"),
    }


@router.post("/setup/smtp/test-and-save")
async def test_and_save_smtp(data: SmtpTestRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 1: Validates Microsoft 365 STARTTLS SMTP connection and delivers test email.
    """
    success, msg = await EmailService.test_and_save_m365_smtp(
        db=db,
        app_password=data.app_password,
        test_recipient=data.test_recipient,
        sender_username=data.sender_username,
    )
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg}


@router.post("/setup/register")
async def register_customer(data: CustomerRegisterRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 2: Submits Customer Registration details, generates Customer ID & single-use token,
    and sends confirmation email.
    """
    try:
        result = await SetupService.register_customer(db, data.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


@router.post("/setup/confirm-email")
async def confirm_email(data: EmailConfirmRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 3: Confirms customer business email using 6-digit PIN or token.
    """
    try:
        result = await SetupService.confirm_email(db, data.customer_id, data.code)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email confirmation failed: {str(e)}")


@router.post("/setup/activate-license")
async def activate_license_wizard(
    data: LicenseActivateWizardRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Step 4: Activates Ed25519 Perpetual License key, binds to Installation ID,
    and delivers Customer Welcome Email.
    """
    ip = request.client.host if request.client else None
    try:
        result = await SetupService.activate_license(db, data.customer_id, data.license_key, ip)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Activation error: {str(e)}")


@router.post("/setup/finalize-admin")
async def finalize_admin(data: FinalizeAdminRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 5: Sets super administrator credentials, provisions Tenant & RBAC,
    marks setup complete, and logs in.
    """
    try:
        result = await SetupService.finalize_admin_setup(db, data.model_dump())
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Setup finalization error: {str(e)}")


@router.post("/setup/complete")
async def complete_setup(setup_data: SetupRequest, db: AsyncSession = Depends(get_db)):
    is_configured = await SetupService.is_configured(db)
    if is_configured:
        raise HTTPException(status_code=400, detail="System already configured")
    try:
        result = await SetupService.complete_setup(db, setup_data.model_dump())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result



@router.post("/setup/resend-otp")
async def resend_otp(data: ResendOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Resends 6-digit OTP verification code to customer business email.
    """
    try:
        result = await SetupService.resend_otp(db, data.customer_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resend OTP failed: {str(e)}")


@router.post("/setup/install-task")
async def run_install_task(data: InstallTaskRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 4: Executes real-time prerequisite and service installation tasks.
    """
    try:
        result = await SetupService.run_install_task(db, data.customer_id, data.task_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Install task execution failed: {str(e)}")


@router.post("/setup/finalize-system")
async def finalize_system(data: FinalizeSystemRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 5: Finalizes system setup, seeds tenant and admin user, and generates auth token.
    """
    try:
        result = await SetupService.finalize_system_installation(
            db, data.customer_id, data.admin_username, data.admin_password, data.admin_full_name
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"System finalization failed: {str(e)}")


@router.get("/customer/profile")
async def get_customer_profile(db: AsyncSession = Depends(get_db)):
    """Returns verified customer details & perpetual license status."""
    return await SetupService.get_customer_profile(db)


@router.post("/auth/login", response_model=TokenResponse)
async def login(login_data: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await UserService.authenticate(db, login_data.username, login_data.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = result["user"]

    # Check if license is valid for this tenant
    if user.tenant_id:
        license_valid = await LicenseService.is_license_valid_for_tenant(db, user.tenant_id)
        if not license_valid:
            raise HTTPException(
                status_code=402,
                detail="License expired or not activated. Please contact support.",
            )

    return TokenResponse(
        access_token=result["access_token"],
        user=UserResponse.model_validate(user),
    )



@router.post("/auth/forgot-password/request")
async def forgot_password_request(data: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 1 of Password Recovery:
    Validates user email, generates 6-digit OTP, and dispatches verification code to registered email address.
    """
    try:
        result = await UserService.request_password_reset(db, data.email, data.captcha_token)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Password reset request failed: {str(e)}")


@router.post("/auth/forgot-password/verify-otp")
async def forgot_password_verify_otp(data: ForgotPasswordVerifyOtpRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 2 of Password Recovery:
    Validates the 6-digit OTP code against secure cryptographic hash and expiration time.
    Returns a single-use password reset token.
    """
    try:
        result = await UserService.verify_password_reset_otp(db, data.email, data.otp)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OTP verification failed: {str(e)}")


@router.post("/auth/forgot-password/reset")
async def forgot_password_reset(data: ForgotPasswordResetRequest, db: AsyncSession = Depends(get_db)):
    """
    Step 3 of Password Recovery:
    Validates single-use reset token and updates the user's password in the database.
    """
    try:
        result = await UserService.reset_password_with_token(db, data.email, data.reset_token, data.new_password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Password update failed: {str(e)}")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "ayalhpc-backend"}
