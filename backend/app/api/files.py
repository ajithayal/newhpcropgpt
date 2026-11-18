"""
AjiCorehpc Manager — Graphical File Manager API
Provides multi-node browsing, chunked streaming upload/download,
file operations (mkdir, rename, copy, move, delete), code preview,
and POSIX ACL sharing over cluster storage.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
import uuid

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, AuditLog, FileShare
from app.services.file_service import FileService

router = APIRouter(prefix="/files", tags=["files"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class MkdirRequest(BaseModel):
    node_ip: Optional[str] = None
    parent_path: str = "/home"
    folder_name: str


class RenameRequest(BaseModel):
    node_ip: Optional[str] = None
    old_path: str
    new_name: str


class DeleteRequest(BaseModel):
    node_ip: Optional[str] = None
    paths: List[str]


class CopyMoveRequest(BaseModel):
    node_ip: Optional[str] = None
    sources: List[str]
    destination: str
    is_move: Optional[bool] = False


class PermissionsRequest(BaseModel):
    node_ip: Optional[str] = None
    path: str
    mode_octal: Optional[str] = None
    owner: Optional[str] = None
    group: Optional[str] = None
    acl_user: Optional[str] = None
    acl_perm: Optional[str] = None


class ShareRequest(BaseModel):
    node_ip: Optional[str] = None
    path: str
    shared_with_type: str = "user"  # user or group
    shared_with_name: str
    permission: str = "read"  # read or write


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/browse")
async def browse_files(
    node_ip: Optional[str] = Query(None, description="Target cluster node IP"),
    path: str = Query("/home", description="Directory path to inspect"),
    search: Optional[str] = Query(None, description="Search query"),
    current_user: User = Depends(get_current_user),
):
    """Browse files and folders on a cluster node with POSIX metadata."""
    return await FileService.browse_directory(node_ip=node_ip or "", path=path, search=search)


@router.post("/mkdir")
async def create_directory(
    data: MkdirRequest,
    current_user: User = Depends(get_current_user),
):
    """Create a new directory on the target cluster node."""
    try:
        return await FileService.create_folder(
            node_ip=data.node_ip or "",
            parent_path=data.parent_path,
            folder_name=data.folder_name,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/rename")
async def rename_item(
    data: RenameRequest,
    current_user: User = Depends(get_current_user),
):
    """Rename a file or folder on the cluster node."""
    try:
        return await FileService.rename_item(
            node_ip=data.node_ip or "",
            old_path=data.old_path,
            new_name=data.new_name,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/delete")
async def delete_items(
    data: DeleteRequest,
    current_user: User = Depends(get_current_user),
):
    """Delete selected files and folders on the cluster node."""
    try:
        return await FileService.delete_items(
            node_ip=data.node_ip or "",
            paths=data.paths,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/delete")
async def delete_items_query(
    path: str = Query(..., description="Path to delete"),
    node_ip: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
):
    """Compatibility delete endpoint for single path query param."""
    return await FileService.delete_items(node_ip=node_ip or "", paths=[path])


@router.post("/copy-move")
async def copy_or_move(
    data: CopyMoveRequest,
    current_user: User = Depends(get_current_user),
):
    """Copy or move files and folders on the cluster node."""
    try:
        return await FileService.copy_or_move_items(
            node_ip=data.node_ip or "",
            sources=data.sources,
            destination=data.destination,
            is_move=data.is_move or False,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/preview")
async def preview_file(
    path: str = Query(...),
    node_ip: Optional[str] = Query(None),
    max_chars: Optional[int] = Query(50000),
    current_user: User = Depends(get_current_user),
):
    """Safe text/code preview for scripts, slurm files, logs, and configs."""
    return await FileService.preview_file(node_ip=node_ip or "", path=path, max_chars=max_chars or 50000)


@router.get("/download")
async def download_file(
    path: str = Query(...),
    node_ip: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
):
    """Stream download file chunk by chunk without memory overhead."""
    return await FileService.stream_download(node_ip=node_ip or "", path=path)


@router.post("/upload")
async def upload_file(
    target_dir: str = Form("/home"),
    node_ip: Optional[str] = Form(None),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a file to the cluster storage."""
    try:
        content = await file.read()
        return await FileService.upload_file(
            node_ip=node_ip or "",
            target_dir=target_dir,
            filename=file.filename,
            file_bytes=content,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.post("/permissions")
async def set_permissions(
    data: PermissionsRequest,
    current_user: User = Depends(require_admin),
):
    """Set POSIX permissions, owner, group, or ACLs on a file or folder."""
    return await FileService.set_permissions_and_acl(
        node_ip=data.node_ip or "",
        path=data.path,
        mode_octal=data.mode_octal,
        owner=data.owner,
        group=data.group,
        acl_user=data.acl_user,
        acl_perm=data.acl_perm,
    )


@router.get("/shares")
async def list_file_shares(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all active file and folder shares with users/groups."""
    stmt = select(FileShare).where(FileShare.tenant_id == current_user.tenant_id)
    result = await db.execute(stmt)
    shares = result.scalars().all()
    return [{
        "id": str(s.id),
        "node_ip": s.node_ip,
        "file_path": s.file_path,
        "is_dir": s.is_dir,
        "shared_with_type": s.shared_with_type,
        "shared_with_name": s.shared_with_name,
        "permission": s.permission,
        "created_at": s.created_at.isoformat() if s.created_at else "",
    } for s in shares]


@router.post("/share")
async def share_file_or_folder(
    data: ShareRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Share a file or directory with an HPC user or group using POSIX ACLs."""
    # Apply ACL via setfacl on node
    acl_p = "rw" if data.permission == "write" else "r"
    await FileService.set_permissions_and_acl(
        node_ip=data.node_ip or "",
        path=data.path,
        acl_user=data.shared_with_name if data.shared_with_type == "user" else None,
        acl_perm=acl_p,
    )

    share = FileShare(
        node_ip=data.node_ip or "",
        file_path=data.path,
        is_dir=True,
        shared_with_type=data.shared_with_type,
        shared_with_name=data.shared_with_name,
        permission=data.permission,
        created_by_id=current_user.id,
        tenant_id=current_user.tenant_id,
    )
    db.add(share)
    db.add(AuditLog(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        action="file_share_create",
        resource_type="file",
        details={"path": data.path, "shared_with": data.shared_with_name, "permission": data.permission},
    ))
    await db.commit()
    await db.refresh(share)
    return {"success": True, "id": str(share.id), "message": f"Shared '{data.path}' with {data.shared_with_name} ({data.permission})."}


@router.delete("/share/{share_id}")
async def revoke_share(
    share_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke sharing permissions on a file or folder."""
    s_uuid = uuid.UUID(share_id)
    share = await db.get(FileShare, s_uuid)
    if not share:
        raise HTTPException(status_code=404, detail="Share record not found")
    await db.delete(share)
    await db.commit()
    return {"success": True, "message": "Share revoked."}

@router.get("/test-connection")
async def test_file_connection(
    node_ip: str = Query(..., description="Target node IP"),
    current_user: User = Depends(get_current_user),
):
    """Probe SFTP/SSH connectivity for file browsing."""
    sftp, ssh, err = FileService.get_sftp_client(node_ip)
    if not sftp:
        err_lower = (err or "").lower()
        if "refused" in err_lower:
            guidance = f"SSH connection refused on port 22 on {node_ip}. Ensure sshd is running."
            code = "CONNECTION_REFUSED"
        elif "timed out" in err_lower or "timeout" in err_lower:
            guidance = f"Connection to {node_ip} timed out. Check network routing and firewall."
            code = "TIMEOUT"
        elif "auth" in err_lower:
            guidance = f"Authentication failed for {node_ip}. Verify SSH credentials."
            code = "AUTH_FAILED"
        else:
            guidance = f"Node {node_ip} unreachable on port 22."
            code = "CONNECT_FAILED"
        return {
            "connected": False,
            "node_ip": node_ip,
            "error": err,
            "error_code": code,
            "recovery_guidance": guidance,
        }
    try:
        sftp.close()
        ssh.close()
    except Exception:
        pass
    return {
        "connected": True,
        "node_ip": node_ip,
        "message": f"Successfully connected to SFTP on {node_ip}:22",
    }

