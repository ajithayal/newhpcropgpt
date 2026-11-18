from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, require_super_admin
from app.schemas.schemas import UserCreate, UserUpdate, UserResponse
from app.services.user_service import UserService

router = APIRouter()


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    tenant_filter = current_user.tenant_id if current_user.role.value != "super_admin" else None
    users = await UserService.list_users(db, skip=skip, limit=limit, tenant_id=tenant_filter)
    return [UserResponse.model_validate(u) for u in users]


@router.post("/users", response_model=UserResponse)
async def create_user(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    existing = await UserService.get_user_by_username(db, user_data.username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    user_data_dict = user_data.model_dump()
    user_data_dict["tenant_id"] = current_user.tenant_id
    user = await UserService.create_user(db, user_data_dict, created_by=current_user.id)

    # Reconciled cluster provisioning
    from app.reconcile.queue import ReconcileQueue
    targets = await ReconcileQueue.get_cluster_targets(db)
    uid = int(user.freeipa_uid or 10001)
    gid = int(user.freeipa_gid or uid)
    reconcile_payload = {
        "username": user.username,
        "uid": uid,
        "gid": gid,
        "home_directory": f"/home/{user.username}",
        "shell": "/bin/bash",
        "password": user_data.password,
        "quota_soft_gb": int(user.quota_storage_gb * 0.8),
        "quota_hard_gb": user.quota_storage_gb,
    }
    op_resp = await ReconcileQueue.enqueue(
        db=db,
        op_type="user_create",
        payload=reconcile_payload,
        targets=targets,
        created_by=current_user.id,
        tenant_id=current_user.tenant_id,
        apply_immediate=True,
    )

    resp = UserResponse.model_validate(user)
    resp.reconcile_status = op_resp.get("status")
    resp.reconcile_message = op_resp.get("summary_message")
    resp.operation_id = op_resp.get("operation_id")
    resp.target_results = op_resp.get("targets")
    return resp


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_profile(
    current_user=Depends(get_current_user),
):
    return UserResponse.model_validate(current_user)


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    user = await UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if current_user.role.value != "super_admin" and user.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Permission denied")
    return UserResponse.model_validate(user)


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    update_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin") and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    user = await UserService.update_user(db, user_id, update_data.model_dump(exclude_unset=True), updated_by=current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from app.reconcile.queue import ReconcileQueue
    targets = await ReconcileQueue.get_cluster_targets(db)
    reconcile_payload = {
        "username": user.username,
        "uid": int(user.freeipa_uid or 10001),
        "gid": int(user.freeipa_gid or 10001),
        "home_directory": f"/home/{user.username}",
        "shell": "/bin/bash",
        "password": update_data.password if hasattr(update_data, "password") else None,
        "quota_soft_gb": int(user.quota_storage_gb * 0.8),
        "quota_hard_gb": user.quota_storage_gb,
    }
    op_resp = await ReconcileQueue.enqueue(
        db=db,
        op_type="user_update",
        payload=reconcile_payload,
        targets=targets,
        created_by=current_user.id,
        tenant_id=current_user.tenant_id,
        apply_immediate=True,
    )

    resp = UserResponse.model_validate(user)
    resp.reconcile_status = op_resp.get("status")
    resp.reconcile_message = op_resp.get("summary_message")
    resp.operation_id = op_resp.get("operation_id")
    resp.target_results = op_resp.get("targets")
    return resp


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    user = await UserService.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    username = user.username

    deleted = await UserService.delete_user(db, user_id, deleted_by=current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")

    from app.reconcile.queue import ReconcileQueue
    targets = await ReconcileQueue.get_cluster_targets(db)
    op_resp = await ReconcileQueue.enqueue(
        db=db,
        op_type="user_delete",
        payload={"username": username, "remove_home": False},
        targets=targets,
        created_by=current_user.id,
        tenant_id=current_user.tenant_id,
        apply_immediate=True,
    )
    return {
        "status": "deleted",
        "username": username,
        "reconcile_status": op_resp.get("status"),
        "summary_message": op_resp.get("summary_message"),
        "targets": op_resp.get("targets"),
        "operation_id": op_resp.get("operation_id"),
    }
