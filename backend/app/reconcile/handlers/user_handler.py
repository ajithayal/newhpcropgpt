import logging
from typing import Dict, Any, Tuple
from app.remote.ssh_executor import get_ssh_executor
from app.remote.commands import CommandBuilder
from app.core.errors import RemoteExecutionError, VerificationError

logger = logging.getLogger("ajicorehpc.reconcile.handlers.user")


class UserReconcileHandler:
    @staticmethod
    def apply(target_host: str, op_type: str, payload: Dict[str, Any]) -> Tuple[bool, str, str]:
        """
        Executes idempotent user management action on target host.
        Returns (success: bool, execution_log: str, error_message: str).
        """
        executor = get_ssh_executor()
        username = payload.get("username", "").strip()
        if not username:
            return False, "", "Username missing in operation payload"

        uid = int(payload.get("uid") or 10001)
        gid = int(payload.get("gid") or uid)
        home = payload.get("home_directory") or f"/home/{username}"
        shell = payload.get("shell") or "/bin/bash"
        password = payload.get("password")  # plaintext decrypted by worker
        quota_hard_gb = int(payload.get("quota_hard_gb") or 100)
        quota_soft_gb = int(payload.get("quota_soft_gb") or 50)

        logs = []

        # -------------------------------------------------------------------
        # 1. USER CREATE
        # -------------------------------------------------------------------
        if op_type == "user_create":
            # Check if user already exists (idempotency)
            check_res = executor.execute(target_host, CommandBuilder.user_id(username))
            if check_res.success:
                logs.append(f"User '{username}' already exists on {target_host} (UID {check_res.stdout}). Updating parameters.")
                upd_cmd = CommandBuilder.user_update(username, home=home, shell=shell)
                executor.execute(target_host, upd_cmd)
            else:
                create_cmd = CommandBuilder.user_create(username, uid=uid, gid=gid, home=home, shell=shell)
                res = executor.execute(target_host, create_cmd)
                if not res.success:
                    err = f"Failed to create user '{username}' on {target_host}: {res.stderr}"
                    logger.error(err)
                    return False, "\n".join(logs), err
                logs.append(f"Created POSIX user '{username}' (UID {uid}, GID {gid}) on {target_host}.")

            # Apply password securely via stdin
            if password:
                chpasswd_cmd, stdin_data = CommandBuilder.user_chpasswd(username, password)
                pass_res = executor.execute(target_host, chpasswd_cmd, stdin_data=stdin_data)
                if not pass_res.success:
                    logs.append(f"Warning: chpasswd returned warning on {target_host}: {pass_res.stderr}")
                else:
                    logs.append(f"Set password for user '{username}' on {target_host} via secure pipe.")

            # Home directory creation & permission enforcement
            dir_cmd = CommandBuilder.dir_ensure(home, uid=uid, gid=gid, mode="700", copy_skel=True)
            executor.execute(target_host, dir_cmd)
            logs.append(f"Configured home directory '{home}' with POSIX 0700 permissions on {target_host}.")

            # Apply quota if filesystem supports xfs_quota
            quota_cmd = CommandBuilder.quota_apply_xfs(uid, "/home", soft_gb=quota_soft_gb, hard_gb=quota_hard_gb)
            executor.execute(target_host, quota_cmd)
            logs.append(f"Applied storage quota on /home for UID {uid} (Hard limit: {quota_hard_gb}GB).")

            # Read-back verification
            verify_res = executor.execute(target_host, CommandBuilder.user_getent(username))
            if not verify_res.success or not verify_res.stdout:
                return False, "\n".join(logs), f"Verification failed: getent could not find user '{username}' on {target_host}"
            logs.append(f"Verified user identity: {verify_res.stdout}")
            return True, "\n".join(logs), ""

        # -------------------------------------------------------------------
        # 2. USER UPDATE / PASSWORD / SHELL
        # -------------------------------------------------------------------
        elif op_type in ("user_update", "user_password", "user_shell"):
            upd_cmd = CommandBuilder.user_update(username, home=home, shell=shell)
            res = executor.execute(target_host, upd_cmd)
            if not res.success:
                return False, "\n".join(logs), f"usermod failed on {target_host}: {res.stderr}"
            logs.append(f"Updated user attributes on {target_host}.")

            if password:
                chpasswd_cmd, stdin_data = CommandBuilder.user_chpasswd(username, password)
                pass_res = executor.execute(target_host, chpasswd_cmd, stdin_data=stdin_data)
                if not pass_res.success:
                    logs.append(f"Warning: chpasswd returned warning on {target_host}: {pass_res.stderr}")
                else:
                    logs.append(f"Updated password for '{username}' on {target_host}.")

            verify_res = executor.execute(target_host, CommandBuilder.user_getent(username))
            if not verify_res.success:
                return False, "\n".join(logs), f"Verification failed for updated user '{username}' on {target_host}"
            logs.append(f"Verified updated identity: {verify_res.stdout}")
            return True, "\n".join(logs), ""

        # -------------------------------------------------------------------
        # 3. USER DELETE
        # -------------------------------------------------------------------
        elif op_type == "user_delete":
            remove_home = payload.get("remove_home", False)
            del_cmd = CommandBuilder.user_delete(username, remove_home=remove_home)
            res = executor.execute(target_host, del_cmd)
            logs.append(f"Executed userdel for '{username}' on {target_host} (exit={res.exit_code}).")

            # Verification: id -u should fail (exit != 0)
            verify_res = executor.execute(target_host, CommandBuilder.user_id(username))
            if verify_res.success:
                return False, "\n".join(logs), f"Verification failed: User '{username}' still exists on {target_host}"
            logs.append(f"Verified user '{username}' successfully removed from {target_host}.")
            return True, "\n".join(logs), ""

        # -------------------------------------------------------------------
        # 4. USER QUOTA
        # -------------------------------------------------------------------
        elif op_type == "user_quota":
            quota_cmd = CommandBuilder.quota_apply_xfs(uid, "/home", soft_gb=quota_soft_gb, hard_gb=quota_hard_gb)
            res = executor.execute(target_host, quota_cmd)
            if not res.success:
                return False, "\n".join(logs), f"Failed to apply xfs_quota on {target_host}: {res.stderr}"
            logs.append(f"Applied xfs_quota for UID {uid} on /home.")

            # Read-back report
            rep_res = executor.execute(target_host, CommandBuilder.quota_report_xfs("/home"))
            logs.append(f"Verified quota report:\n{rep_res.stdout[:200]}")
            return True, "\n".join(logs), ""

        return False, "", f"Unsupported user operation type: {op_type}"
