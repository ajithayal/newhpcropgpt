"""
AjiCorehpc Manager — Real Node File Manager Service
Provides graphical File Explorer capabilities across cluster nodes,
NFS shared directories, user home spaces, and backup repositories.
"""
import os
import stat
import time
import shutil
import logging
from typing import Dict, Any, List, Optional, Tuple, AsyncGenerator
from datetime import datetime
import paramiko
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

from app.services.storage_service import StorageService

logger = logging.getLogger("file_service")


class FileService:
    ALLOWED_BASE_ROOTS = [
        "/home", "/scratch", "/project", "/apps",
        "/backup", "/var/log", "/etc/slurm", "/opt",
    ]

    @classmethod
    def sanitize_path(cls, requested: str) -> str:
        """Sanitizes path to prevent directory traversal and verify allowed roots."""
        if not requested or requested.strip() == "":
            return "/home"
        clean = requested.replace("\\", "/").strip()
        # Resolve double slashes and dot references
        parts = []
        for segment in clean.split("/"):
            if not segment or segment == ".":
                continue
            if segment == "..":
                if parts:
                    parts.pop()
            else:
                parts.append(segment)
        resolved = "/" + "/".join(parts)

        # Ensure inside permitted roots or root view
        if resolved == "/":
            return "/"
        for root in cls.ALLOWED_BASE_ROOTS:
            if resolved == root or resolved.startswith(root.rstrip("/") + "/"):
                return resolved

        # Default fallback to /home
        return "/home"

    @classmethod
    def get_sftp_client(cls, node_ip: str) -> Tuple[Optional[paramiko.SFTPClient], Optional[paramiko.SSHClient], Optional[str]]:
        """Opens an SFTP session to the target node."""
        ssh, err = StorageService.get_ssh_client(node_ip)
        if not ssh:
            return None, None, f"Failed to connect to node {node_ip}: {err}"
        try:
            sftp = ssh.open_sftp()
            return sftp, ssh, None
        except Exception as e:
            try: ssh.close()
            except Exception: pass
            return None, None, str(e)

    @classmethod
    async def browse_directory(
        cls,
        node_ip: str,
        path: str = "/home",
        search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Lists files and folders with full POSIX attributes."""
        clean_path = cls.sanitize_path(path)
        if not node_ip or not node_ip.strip():
            return {
                "connected": False,
                "node_ip": "",
                "error": "No cluster node selected.",
                "error_code": "NO_NODE_SELECTED",
                "recovery_guidance": "Please select an active cluster node from the dropdown to browse its files.",
                "items": [],
                "breadcrumbs": [{"label": "Root", "path": "/"}],
                "current_path": clean_path,
                "parent_path": "/",
                "total_items": 0,
            }

        sftp, ssh, err = cls.get_sftp_client(node_ip)
        if not sftp:
            err_lower = (err or "").lower()
            if "refused" in err_lower:
                code_type = "CONNECTION_REFUSED"
                guidance = f"SSH connection to {node_ip}:22 was refused. Verify sshd is running (`systemctl status sshd`)."
            elif "timed out" in err_lower or "timeout" in err_lower:
                code_type = "TIMEOUT"
                guidance = f"Connection to {node_ip}:22 timed out. Verify the host is powered on and firewall permits port 22."
            elif "auth" in err_lower:
                code_type = "AUTH_FAILED"
                guidance = f"SSH authentication failed on {node_ip}. Update node credentials in Cluster Settings."
            else:
                code_type = "CONNECT_FAILED"
                guidance = f"Failed to establish SFTP session to {node_ip}. Ensure node is reachable and SSH is operational."

            return {
                "connected": False,
                "node_ip": node_ip,
                "error": err or "Failed to connect to node",
                "error_code": code_type,
                "recovery_guidance": guidance,
                "items": [],
                "breadcrumbs": [{"label": "Root", "path": "/"}],
                "current_path": clean_path,
                "parent_path": "/",
                "total_items": 0,
            }

        items = []
        try:
            # If path is "/", list the allowed base roots that actually exist
            if clean_path == "/":
                for root in cls.ALLOWED_BASE_ROOTS:
                    try:
                        attr = sftp.stat(root)
                        items.append(cls._format_attr(root, os.path.basename(root), attr))
                    except Exception:
                        pass
            else:
                try:
                    dir_attrs = sftp.listdir_attr(clean_path)
                except FileNotFoundError:
                    raise HTTPException(status_code=404, detail=f"Directory '{clean_path}' does not exist on {node_ip}")
                except Exception as e:
                    raise HTTPException(status_code=400, detail=f"Failed to read '{clean_path}': {str(e)}")

                for attr in dir_attrs:
                    name = attr.filename
                    if name in [".", ".."]:
                        continue
                    full_p = f"{clean_path.rstrip('/')}/{name}"
                    items.append(cls._format_attr(full_p, name, attr))

            # Filter if search query provided
            if search and search.strip():
                q = search.strip().lower()
                items = [it for it in items if q in it["name"].lower()]

            # Sort directories first, then alphabetically
            items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

            # Breadcrumbs
            segments = clean_path.split("/")
            breadcrumbs = [{"label": "Root", "path": "/"}]
            curr = ""
            for seg in segments:
                if seg:
                    curr += f"/{seg}"
                    breadcrumbs.append({"label": seg, "path": curr})

            return {
                "connected": True,
                "node_ip": node_ip,
                "current_path": clean_path,
                "parent_path": "/".join(clean_path.rstrip("/").split("/")[:-1]) or "/",
                "breadcrumbs": breadcrumbs,
                "total_items": len(items),
                "items": items,
            }
        finally:
            try: sftp.close()
            except Exception: pass
            try: ssh.close()
            except Exception: pass

    @classmethod
    def _format_attr(cls, full_path: str, name: str, attr: paramiko.SFTPAttributes) -> Dict[str, Any]:
        is_directory = stat.S_ISDIR(attr.st_mode) if attr.st_mode is not None else False
        mode_str = stat.filemode(attr.st_mode) if attr.st_mode is not None else "----------"
        mod_time = datetime.fromtimestamp(attr.st_mtime).isoformat() if attr.st_mtime else ""

        ext = ""
        if not is_directory and "." in name:
            ext = name.rsplit(".", 1)[-1].lower()

        # Human size
        raw_size = attr.st_size if attr.st_size is not None else 0
        def human_size(n: int) -> str:
            if is_directory: return "--"
            if n < 1024: return f"{n} B"
            if n < 1024*1024: return f"{(n/1024):.1f} KB"
            if n < 1024*1024*1024: return f"{(n/(1024*1024)):.1f} MB"
            return f"{(n/(1024*1024*1024)):.2f} GB"

        return {
            "name": name,
            "path": full_path,
            "is_dir": is_directory,
            "size": raw_size,
            "size_formatted": human_size(raw_size),
            "modified": mod_time,
            "permissions": mode_str,
            "mode_octal": oct(attr.st_mode & 0o777) if attr.st_mode else "0755",
            "uid": attr.st_uid if attr.st_uid is not None else 0,
            "gid": attr.st_gid if attr.st_gid is not None else 0,
            "extension": ext,
        }

    # ---------------------------------------------------------------------------
    # File Operations
    # ---------------------------------------------------------------------------

    @classmethod
    async def create_folder(cls, node_ip: str, parent_path: str, folder_name: str) -> Dict[str, Any]:
        name = folder_name.strip().replace("/", "")
        if not name or ".." in name:
            raise ValueError("Invalid folder name")
        clean_parent = cls.sanitize_path(parent_path)
        target_path = f"{clean_parent.rstrip('/')}/{name}"

        code, out, err = StorageService.execute_command(node_ip, f"mkdir -p {target_path} && chmod 0755 {target_path}")
        if code != 0:
            raise RuntimeError(f"Failed to create directory: {err}")
        return {"success": True, "path": target_path, "message": f"Folder '{name}' created."}

    @classmethod
    async def rename_item(cls, node_ip: str, old_path: str, new_name: str) -> Dict[str, Any]:
        clean_old = cls.sanitize_path(old_path)
        name = new_name.strip().replace("/", "")
        if not name or ".." in name:
            raise ValueError("Invalid new name")
        clean_parent = os.path.dirname(clean_old)
        new_path = f"{clean_parent.rstrip('/')}/{name}"

        code, out, err = StorageService.execute_command(node_ip, f"mv -n {clean_old} {new_path}")
        if code != 0:
            raise RuntimeError(f"Rename failed: {err}")
        return {"success": True, "old_path": clean_old, "new_path": new_path, "message": f"Renamed to '{name}'."}

    @classmethod
    async def delete_items(cls, node_ip: str, paths: List[str]) -> Dict[str, Any]:
        deleted = []
        for p in paths:
            clean = cls.sanitize_path(p)
            # Safeguard system directories
            if clean in ["/", "/home", "/scratch", "/apps", "/project", "/boot", "/etc", "/var", "/backup"]:
                continue
            code, _, err = StorageService.execute_command(node_ip, f"rm -rf {clean}")
            if code == 0:
                deleted.append(clean)
        return {"success": True, "deleted_count": len(deleted), "deleted_paths": deleted}

    @classmethod
    async def copy_or_move_items(cls, node_ip: str, sources: List[str], destination: str, is_move: bool = False) -> Dict[str, Any]:
        clean_dest = cls.sanitize_path(destination)
        action_cmd = "mv" if is_move else "cp -r"
        processed = []
        for s in sources:
            clean_src = cls.sanitize_path(s)
            code, _, err = StorageService.execute_command(node_ip, f"{action_cmd} {clean_src} {clean_dest}/")
            if code == 0:
                processed.append(clean_src)
        verb = "Moved" if is_move else "Copied"
        return {"success": True, "count": len(processed), "message": f"{verb} {len(processed)} item(s) to {clean_dest}."}

    @classmethod
    async def preview_file(cls, node_ip: str, path: str, max_chars: int = 50000) -> Dict[str, Any]:
        clean_path = cls.sanitize_path(path)
        # Read first max_chars safely
        cmd = f"head -c {max_chars} {clean_path} 2>/dev/null"
        code, out, err = StorageService.execute_command(node_ip, cmd)
        if code != 0:
            raise HTTPException(status_code=400, detail=f"Cannot preview file: {err}")

        # Check total size
        stat_code, stat_out, _ = StorageService.execute_command(node_ip, f"stat -c '%s %Y %A %U %G' {clean_path}")
        tokens = stat_out.split()
        size_bytes = int(tokens[0]) if len(tokens) > 0 and tokens[0].isdigit() else len(out)
        perm = tokens[2] if len(tokens) > 2 else ""
        owner = tokens[3] if len(tokens) > 3 else "root"
        group = tokens[4] if len(tokens) > 4 else "root"

        ext = clean_path.rsplit(".", 1)[-1].lower() if "." in clean_path else "txt"

        return {
            "path": clean_path,
            "filename": os.path.basename(clean_path),
            "size_bytes": size_bytes,
            "content": out,
            "is_truncated": size_bytes > max_chars,
            "permissions": perm,
            "owner": owner,
            "group": group,
            "extension": ext,
        }

    @classmethod
    async def stream_download(cls, node_ip: str, path: str) -> StreamingResponse:
        """Streams a file from a remote node via SFTP without loading into RAM."""
        clean_path = cls.sanitize_path(path)
        sftp, ssh, err = cls.get_sftp_client(node_ip)
        if not sftp:
            raise HTTPException(status_code=502, detail=err)

        try:
            stat_attr = sftp.stat(clean_path)
            file_size = stat_attr.st_size
            remote_file = sftp.open(clean_path, "rb")
        except Exception as e:
            try: sftp.close()
            except Exception: pass
            try: ssh.close()
            except Exception: pass
            raise HTTPException(status_code=404, detail=f"File not found: {str(e)}")

        async def file_generator() -> AsyncGenerator[bytes, None]:
            try:
                while True:
                    chunk = remote_file.read(65536)  # 64KB chunks
                    if not chunk:
                        break
                    yield chunk
            finally:
                remote_file.close()
                sftp.close()
                ssh.close()

        filename = os.path.basename(clean_path)
        return StreamingResponse(
            file_generator(),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(file_size),
            }
        )

    @classmethod
    async def upload_file(cls, node_ip: str, target_dir: str, filename: str, file_bytes: bytes) -> Dict[str, Any]:
        clean_dir = cls.sanitize_path(target_dir)
        safe_name = os.path.basename(filename).replace("/", "")
        target_path = f"{clean_dir.rstrip('/')}/{safe_name}"

        sftp, ssh, err = cls.get_sftp_client(node_ip)
        if not sftp:
            raise HTTPException(status_code=502, detail=err)

        try:
            with sftp.open(target_path, "wb") as f:
                f.write(file_bytes)
            # Set POSIX 0644
            sftp.chmod(target_path, 0o644)
            return {
                "success": True,
                "path": target_path,
                "filename": safe_name,
                "size": len(file_bytes),
                "message": f"Successfully uploaded '{safe_name}' ({len(file_bytes)} bytes) to {target_dir}."
            }
        finally:
            try: sftp.close()
            except Exception: pass
            try: ssh.close()
            except Exception: pass

    @classmethod
    async def set_permissions_and_acl(
        cls,
        node_ip: str,
        path: str,
        mode_octal: Optional[str] = None,
        owner: Optional[str] = None,
        group: Optional[str] = None,
        acl_user: Optional[str] = None,
        acl_perm: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Sets POSIX mode, ownership, or POSIX ACL permissions."""
        clean_path = cls.sanitize_path(path)
        logs = []

        if mode_octal:
            code, _, err = StorageService.execute_command(node_ip, f"chmod {mode_octal} {clean_path}")
            if code == 0:
                logs.append(f"Applied mode {mode_octal}")
            else:
                logs.append(f"chmod failed: {err}")

        if owner or group:
            ch_target = f"{owner or ''}:{group or ''}".strip(":")
            code, _, err = StorageService.execute_command(node_ip, f"chown {ch_target} {clean_path}")
            if code == 0:
                logs.append(f"Updated ownership to {ch_target}")
            else:
                logs.append(f"chown failed: {err}")

        if acl_user and acl_perm:
            # Check if setfacl is installed and apply
            code, _, err = StorageService.execute_command(node_ip, f"setfacl -m u:{acl_user}:{acl_perm} {clean_path}")
            if code == 0:
                logs.append(f"Applied POSIX ACL: u:{acl_user}:{acl_perm}")
            else:
                logs.append(f"setfacl warning: {err}")

        return {"success": True, "path": clean_path, "logs": logs}
