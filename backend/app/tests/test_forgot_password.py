import pytest
import hashlib
import json
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import User, UserRole, SystemConfig
from app.core.security import get_password_hash, verify_password
from app.services.user_service import UserService


@pytest.mark.asyncio
async def test_forgot_password_full_flow(test_db: AsyncSession):
    # Setup admin user with real admin business email
    test_email = "support.infra2@layatech.com"
    test_username = "admin"
    old_password = "OldInitialPassword123!"
    new_password = "NewEnterprisePassword456@"

    user = User(
        username=test_username,
        email=test_email,
        hashed_password=get_password_hash(old_password),
        full_name="System Administrator",
        role=UserRole.SUPER_ADMIN,
        is_active=True,
    )
    test_db.add(user)
    await test_db.commit()
    await test_db.refresh(user)

    # 1. Request OTP with bot verification token
    req_res = await UserService.request_password_reset(test_db, test_email, captcha_token="human_verified_token")
    assert req_res["success"] is True
    assert "email" in req_res

    # Read OTP directly from DB for test verification
    cfg = await test_db.execute(select(SystemConfig).where(SystemConfig.key == f"pwd_reset_otp_{test_email}"))
    cfg_row = cfg.scalar_one_or_none()
    assert cfg_row is not None
    data = json.loads(cfg_row.value)
    assert data["username"] == test_username

    # Try invalid OTP
    with pytest.raises(ValueError, match="Incorrect verification code"):
        await UserService.verify_password_reset_otp(test_db, test_email, "000000")

    # Set known hash for test: "123456"
    data["otp_hash"] = hashlib.sha256("123456".encode()).hexdigest()
    cfg_row.value = json.dumps(data)
    await test_db.commit()

    # 2. Verify with valid OTP "123456" - retrieves existing username
    verify_res = await UserService.verify_password_reset_otp(test_db, test_email, "123456")
    assert verify_res["success"] is True
    assert "reset_token" in verify_res
    assert verify_res["username"] == test_username
    reset_tok = verify_res["reset_token"]

    # Verify OTP key is deleted
    cfg_otp_deleted = await test_db.execute(select(SystemConfig).where(SystemConfig.key == f"pwd_reset_otp_{test_email}"))
    assert cfg_otp_deleted.scalar_one_or_none() is None

    # 3. Reset password with new password - username must remain unchanged
    reset_res = await UserService.reset_password_with_token(test_db, test_email, reset_tok, new_password)
    assert reset_res["success"] is True
    assert reset_res["username"] == test_username

    # Verify user record in DB still has unchanged username
    refreshed_user = await UserService.get_user(test_db, user.id)
    assert refreshed_user.username == test_username

    # 4. Verify user can authenticate with new password and cannot authenticate with old password
    auth_old = await UserService.authenticate(test_db, test_username, old_password)
    assert auth_old is None

    auth_new = await UserService.authenticate(test_db, test_username, new_password)
    assert auth_new is not None
    assert auth_new["user"].id == user.id

    # 5. Verify token cannot be reused
    with pytest.raises(ValueError, match="expired or invalid"):
        await UserService.reset_password_with_token(test_db, test_email, reset_tok, "AnotherPassword789#")
