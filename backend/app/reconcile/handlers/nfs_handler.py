import logging
from typing import Dict, Any, Tuple
from app.remote.ssh_executor import get_ssh_executor
from app.remote.commands import CommandBuilder

logger = logging.getLogger("ajicorehpc.reconcile.handlers.nfs")


class NfsReconcileHandler:
    @staticmethod
    def apply(target_host: str, op_type: str, payload: Dict[str, Any]) -> Tuple[bool, str, str]:
        executor = get_ssh_executor()
        logs = []

        # -------------------------------------------------------------------
        # 1. NFS EXPORT ON MASTER
        # -------------------------------------------------------------------
        if op_type == "nfs_export":
            path = payload.get("path", "/apps")
            subnet = payload.get("subnet", "*")
            options = payload.get("options", "rw,sync,no_root_squash,no_subtree_check")
            export_file = payload.get("export_file", "/etc/exports.d/ajicorehpc-apps.exports")

            export_line = f"{path} {subnet}({options})"
            apply_cmd = CommandBuilder.exportfs_apply(export_line, export_file)
            res = executor.execute(target_host, apply_cmd)
            if not res.success:
                err = f"Failed to configure NFS export on {target_host}: {res.stderr}"
                return False, "\n".join(logs), err
            logs.append(f"Wrote export '{export_line}' to {export_file} on {target_host}.")

            # Open firewall ports
            fw_res = executor.execute(target_host, CommandBuilder.firewall_nfs())
            logs.append(f"Configured firewalld NFS services on {target_host}.")

            # Verification: exportfs -v
            verify_res = executor.execute(target_host, CommandBuilder.exportfs_verify())
            if not verify_res.success or path not in verify_res.stdout:
                err = f"Verification failed: {path} not found in exportfs -v on {target_host}"
                return False, "\n".join(logs), err
            logs.append(f"Verified NFS export active on {target_host}:\n{verify_res.stdout}")
            return True, "\n".join(logs), ""

        # -------------------------------------------------------------------
        # 2. NFS MOUNT ON NODE
        # -------------------------------------------------------------------
        elif op_type == "nfs_mount":
            server_ip = payload.get("server_ip")
            server_path = payload.get("server_path", "/apps")
            mount_point = payload.get("mount_point", "/apps")
            mount_options = payload.get("options", "nfs4 _netdev,nofail,x-systemd.automount,bg,intr")

            if not server_ip:
                return False, "", "Server IP missing in nfs_mount payload"

            fstab_line = f"{server_ip}:{server_path} {mount_point} {mount_options} 0 0"

            cmds = [
                f"mkdir -p {mount_point}",
                f"grep -qxF '{fstab_line}' /etc/fstab || echo '{fstab_line}' >> /etc/fstab",
                f"mount {mount_point} 2>/dev/null || mount -a",
            ]
            res = executor.execute(target_host, " && ".join(cmds))
            logs.append(f"Configured fstab and triggered mount for {mount_point} on {target_host}.")

            # Verification: findmnt
            verify_res = executor.execute(target_host, CommandBuilder.findmnt(mount_point))
            if not verify_res.success or not verify_res.stdout:
                err = f"Verification failed: findmnt could not verify active mount at {mount_point} on {target_host}"
                return False, "\n".join(logs), err
            logs.append(f"Verified active mount:\n{verify_res.stdout}")
            return True, "\n".join(logs), ""

        return False, "", f"Unsupported NFS operation type: {op_type}"
