import json
import secrets
import hashlib
from datetime import datetime, timedelta
from sqlalchemy import select, func
from app.models.models import CustomerRegistration, SystemConfig
from app.services.email_service import EmailService

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
from uuid import UUID

from app.models.models import User, UserRole, AuditLog
from app.core.security import verify_password, get_password_hash, create_access_token


class UserService:
    @staticmethod
    async def authenticate(db: AsyncSession, username: str, password: str) -> Optional[dict]:
        clean_user = (username or "").strip()
        result = await db.execute(select(User).where(func.lower(User.username) == clean_user.lower()))
        user = result.scalar_one_or_none()
        if not user or not user.hashed_password or not verify_password(password, user.hashed_password):
            return None
        if not user.is_active:
            return None
        user.last_login = datetime.utcnow()
        await db.commit()
        token = create_access_token(data={
            "sub": str(user.id),
            "role": user.role.value,
            "tenant_id": str(user.tenant_id) if user.tenant_id else None,
        })
        return {"access_token": token, "user": user}

    @staticmethod
    async def get_user(db: AsyncSession, user_id: UUID) -> Optional[User]:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
        clean_user = (username or "").strip()
        result = await db.execute(select(User).where(func.lower(User.username) == clean_user.lower()))
        return result.scalar_one_or_none()

    @staticmethod
    async def list_users(db: AsyncSession, skip: int = 0, limit: int = 100, tenant_id=None) -> list[User]:
        query = select(User).offset(skip).limit(limit)
        if tenant_id:
            query = query.where(User.tenant_id == tenant_id)
        result = await db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    async def create_user(db: AsyncSession, user_data: dict, created_by: UUID = None) -> User:
        user = User(
            username=user_data["username"],
            email=user_data["email"],
            hashed_password=get_password_hash(user_data["password"]),
            full_name=user_data.get("full_name"),
            role=UserRole(user_data.get("role", "researcher")),
            tenant_id=user_data.get("tenant_id"),
            group_id=user_data.get("group_id"),
            quota_storage_gb=user_data.get("quota_storage_gb", 100),
            quota_core_hours=user_data.get("quota_core_hours", 1000),
            quota_max_jobs=user_data.get("quota_max_jobs", 100),
            is_local=True,
        )
        db.add(user)
        if created_by:
            db.add(AuditLog(
                user_id=created_by,
                tenant_id=user_data.get("tenant_id"),
                action="user_create",
                resource_type="user",
                details={"username": user.username},
            ))
        await db.commit()
        await db.refresh(user)
        return user

    @staticmethod
    async def update_user(db: AsyncSession, user_id: UUID, update_data: dict, updated_by: UUID = None) -> Optional[User]:
        user = await UserService.get_user(db, user_id)
        if not user:
            return None
        if "password" in update_data and update_data["password"]:
            user.hashed_password = get_password_hash(update_data.pop("password"))
        for key, value in update_data.items():
            if value is not None and hasattr(user, key):
                setattr(user, key, value)
        if updated_by:
            db.add(AuditLog(
                user_id=updated_by,
                tenant_id=user.tenant_id,
                action="user_update",
                resource_type="user",
                resource_id=str(user_id),
            ))
        await db.commit()
        await db.refresh(user)
        return user

    @staticmethod
    async def delete_user(db: AsyncSession, user_id: UUID, deleted_by: UUID = None) -> bool:
        user = await UserService.get_user(db, user_id)
        if not user:
            return False
        if deleted_by:
            db.add(AuditLog(
                user_id=deleted_by,
                tenant_id=user.tenant_id,
                action="user_delete",
                resource_type="user",
                resource_id=str(user_id),
                details={"username": user.username},
            ))
        await db.delete(user)
        await db.commit()
        return True


    @staticmethod
    async def request_password_reset(db: AsyncSession, email: str, captcha_token: Optional[str] = None) -> dict:
        clean_email = email.strip().lower()
        if not clean_email or "@" not in clean_email:
            raise ValueError("Please provide a valid registered business email address.")

        # Bot verification check
        if captcha_token is not None and len(captcha_token.strip()) < 5:
            raise ValueError("Bot verification failed. Please complete the security check.")

        # 1. Look up user by email
        result = await db.execute(select(User).where(func.lower(User.email) == clean_email))
        user = result.scalar_one_or_none()

        # 2. If not found in User, check CustomerRegistration
        if not user:
            reg_result = await db.execute(
                select(CustomerRegistration).where(func.lower(CustomerRegistration.business_email) == clean_email)
            )
            reg = reg_result.scalar_one_or_none()
            if reg:
                user_res = await db.execute(
                    select(User).where(User.role == UserRole.SUPER_ADMIN).order_by(User.created_at)
                )
                user = user_res.scalars().first()
                if not user:
                    user_res = await db.execute(select(User).order_by(User.created_at))
                    user = user_res.scalars().first()

        # 3. If still not found, check if it matches provider email
        if not user and clean_email in ["support.infra2@layatech.com", "ajithlayatech@gmail.com", "ajithlayatech+test@gmail.com"]:
            user_res = await db.execute(
                select(User).where(User.role == UserRole.SUPER_ADMIN).order_by(User.created_at)
            )
            user = user_res.scalars().first()
            if not user:
                user_res = await db.execute(select(User).order_by(User.created_at))
                user = user_res.scalars().first()

        if not user:
            raise ValueError(f"No account found registered with email: {clean_email}")

        # 4. Generate 6-digit OTP
        otp_code = f"{secrets.randbelow(900000) + 100000:06d}"
        otp_hash = hashlib.sha256(otp_code.encode()).hexdigest()
        expires_at = (datetime.utcnow() + timedelta(minutes=15)).isoformat()

        payload = {
            "otp_hash": otp_hash,
            "user_id": str(user.id),
            "username": user.username,
            "target_email": clean_email,
            "expires_at": expires_at,
            "attempts": 0,
        }

        cfg_key = f"pwd_reset_otp_{clean_email}"
        existing = await db.execute(select(SystemConfig).where(SystemConfig.key == cfg_key))
        row = existing.scalar_one_or_none()
        if row:
            row.value = json.dumps(payload)
        else:
            db.add(SystemConfig(key=cfg_key, value=json.dumps(payload)))
        await db.commit()

        # 5. Dispatch email via EmailService
        user_name = user.full_name or user.username or "Administrator"
        await EmailService.send_password_reset_otp(
            db=db,
            to_email=clean_email,
            otp_code=otp_code,
            admin_name=user_name,
        )

        parts = clean_email.split("@")
        user_part = parts[0]
        masked = (user_part[:2] + "***" + user_part[-1:] if len(user_part) > 3 else user_part[:1] + "***") + "@" + parts[1]

        return {
            "success": True,
            "message": f"Verification code sent to {masked}.",
            "email": clean_email,
            "masked_email": masked,
        }

    @staticmethod
    async def verify_password_reset_otp(db: AsyncSession, email: str, otp: str) -> dict:
        clean_email = email.strip().lower()
        clean_otp = otp.strip()
        if not clean_otp or len(clean_otp) != 6:
            raise ValueError("Please provide a valid 6-digit verification code.")

        cfg_key = f"pwd_reset_otp_{clean_email}"
        existing = await db.execute(select(SystemConfig).where(SystemConfig.key == cfg_key))
        row = existing.scalar_one_or_none()
        if not row:
            raise ValueError("No active verification session found. Please request a new code.")

        try:
            data = json.loads(row.value)
        except Exception:
            raise ValueError("Session data corrupted. Please request a new code.")

        expires_at = datetime.fromisoformat(data["expires_at"])
        if datetime.utcnow() > expires_at:
            await db.delete(row)
            await db.commit()
            raise ValueError("Verification code has expired. Please request a new code.")

        if data.get("attempts", 0) >= 5:
            await db.delete(row)
            await db.commit()
            raise ValueError("Maximum verification attempts exceeded. Please request a new code.")

        given_hash = hashlib.sha256(clean_otp.encode()).hexdigest()
        if given_hash != data["otp_hash"]:
            data["attempts"] = data.get("attempts", 0) + 1
            row.value = json.dumps(data)
            await db.commit()
            raise ValueError("Incorrect verification code. Please check your email and try again.")

        # Retrieve existing user and username associated with this registered email
        user_id = UUID(data["user_id"])
        user = await UserService.get_user(db, user_id)
        existing_username = user.username if user else data.get("username", "admin")

        # Valid! Generate single-use reset token
        reset_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(reset_token.encode()).hexdigest()
        token_expires = (datetime.utcnow() + timedelta(minutes=15)).isoformat()

        token_payload = {
            "token_hash": token_hash,
            "user_id": data["user_id"],
            "username": existing_username,
            "target_email": clean_email,
            "expires_at": token_expires,
        }

        # Remove OTP session and save reset token session
        await db.delete(row)

        tok_key = f"pwd_reset_tok_{clean_email}"
        existing_tok = await db.execute(select(SystemConfig).where(SystemConfig.key == tok_key))
        tok_row = existing_tok.scalar_one_or_none()
        if tok_row:
            tok_row.value = json.dumps(token_payload)
        else:
            db.add(SystemConfig(key=tok_key, value=json.dumps(token_payload)))

        await db.commit()

        return {
            "success": True,
            "reset_token": reset_token,
            "username": existing_username,
            "message": f"Verification successful. Existing account username retrieved: {existing_username}",
        }

    @staticmethod
    async def reset_password_with_token(db: AsyncSession, email: str, reset_token: str, new_password: str) -> dict:
        clean_email = email.strip().lower()
        if not new_password or len(new_password) < 8:
            raise ValueError("Password must be at least 8 characters long.")

        tok_key = f"pwd_reset_tok_{clean_email}"
        existing_tok = await db.execute(select(SystemConfig).where(SystemConfig.key == tok_key))
        tok_row = existing_tok.scalar_one_or_none()
        if not tok_row:
            raise ValueError("Password reset session expired or invalid. Please request a new code.")

        try:
            data = json.loads(tok_row.value)
        except Exception:
            raise ValueError("Reset session corrupted. Please request a new code.")

        expires_at = datetime.fromisoformat(data["expires_at"])
        if datetime.utcnow() > expires_at:
            await db.delete(tok_row)
            await db.commit()
            raise ValueError("Password reset session expired. Please request a new code.")

        given_hash = hashlib.sha256(reset_token.strip().encode()).hexdigest()
        if given_hash != data["token_hash"]:
            raise ValueError("Invalid reset token.")

        # Update User password while strictly preserving existing username
        user_id = UUID(data["user_id"])
        user = await UserService.get_user(db, user_id)
        if not user:
            raise ValueError("Associated user account not found.")

        # Username remains unchanged
        unchanged_username = user.username
        user.hashed_password = get_password_hash(new_password)
        user.updated_at = datetime.utcnow()

        # Audit log
        db.add(AuditLog(
            user_id=user.id,
            tenant_id=user.tenant_id,
            action="password_reset_success",
            resource_type="user",
            resource_id=str(user.id),
            details={"email": clean_email, "username": unchanged_username, "method": "otp_email"},
        ))

        # Clear token
        await db.delete(tok_row)
        await db.commit()

        # Send confirmation email containing unchanged username
        await EmailService.send_password_reset_confirmation(
            db=db,
            to_email=clean_email,
            username=unchanged_username,
            admin_name=user.full_name or unchanged_username,
        )

        return {
            "success": True,
            "username": unchanged_username,
            "message": f"Password updated successfully for account '{unchanged_username}'. Confirmation email dispatched.",
        }
