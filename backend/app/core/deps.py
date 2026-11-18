"""
Core dependencies for FastAPI: tenant extraction, current user, RBAC checks.
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.core.database import get_db
from app.core.security import decode_access_token
from app.services.user_service import UserService


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_access_token(auth.split(" ")[1])
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await UserService.get_user(db, UUID(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def get_current_tenant(
    current_user=Depends(get_current_user),
):
    return current_user.tenant_id


def require_role(*allowed_roles: str):
    async def _check(current_user=Depends(get_current_user)):
        if current_user.role.value not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return _check


async def require_admin(
    current_user=Depends(get_current_user),
):
    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def require_super_admin(
    current_user=Depends(get_current_user),
):
    if current_user.role.value != "super_admin":
        raise HTTPException(status_code=403, detail="Super admin access required")
    return current_user
