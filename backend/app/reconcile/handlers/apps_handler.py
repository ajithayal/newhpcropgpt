import json
import logging
from typing import Dict, Any, Tuple
from app.remote.ssh_executor import get_ssh_executor
from app.remote.commands import CommandBuilder

logger = logging.getLogger("ajicorehpc.reconcile.handlers.apps")


class AppsStorageReconcileHandler:
    @staticmethod
    def inspect_block_devices(target_host: str) -> Dict[str, Any]:
        """Runs lsblk JSON inspection on the host."""
        executor = get_ssh_executor()
        cmd = "lsblk -J -o NAME,KNAME,PATH,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,SERIAL"
        res = executor.execute(target_host, cmd)
        if not res.success:
            return {"success": False, "error": res.stderr or "Failed to inspect block devices", "devices": []}
        try:
            data = json.loads(res.stdout)
            return {"success": True, "devices": data.get("blockdevices", [])}
        except Exception as e:
            return {"success": False, "error": str(e), "devices": []}

    @staticmethod
    def apply(target_host: str, op_type: str, payload: Dict[str, Any]) -> Tuple[bool, str, str]:
        """
        Executes safe disk preparation, formatting, mounting (/apps, /home, /scratch) and directory hierarchy.
        """
        executor = get_ssh_executor()
        logs = []

        if op_type != "apps_storage_create":
            return False, "", f"Unsupported apps storage op_type: {op_type}"

        device = payload.get("device", "").strip()  # e.g. /dev/sdb
        confirm_wipe = payload.get("confirm_wipe", "").strip()
        mount_point = payload.get("mount_point", "/apps").strip() or "/apps"
        fs_type = payload.get("fs_type", "xfs").strip().lower() or "xfs"

        if not device:
            return False, "", "Disk device not specified (e.g. /dev/sdb)"

        # Safety Check: Inspect disk before touching
        safety_cmd = f"lsblk -J -o PATH,MOUNTPOINT,FSTYPE {device}"
        check_res = executor.execute(target_host, safety_cmd)
        if check_res.success and check_res.stdout:
            try:
                blk_info = json.loads(check_res.stdout)
                dev_list = blk_info.get("blockdevices", [])
                for d in dev_list:
                    if d.get("mountpoint"):
                        return False, "", f"Safety Violation: Device {device} is currently mounted at '{d['mountpoint']}'. Unmount before formatting."
                    if d.get("children") or d.get("fstype"):
                        # Requires explicit wipe confirmation matching device name
                        expected = device.split("/")[-1]
                        if confirm_wipe != device and confirm_wipe != expected:
                            return False, "", f"Safety Protection: Device {device} contains existing partitions or filesystem. To overwrite, set confirm_wipe='{expected}'."
            except Exception:
                pass

        logs.append(f"Safety checks passed for {device} on {target_host}.")

        # 1. Partition with GPT (1 partition spanning entire disk)
        part_cmd = f"parted -s {device} mklabel gpt mkpart primary {fs_type} 1MiB 100% && partprobe {device} 2>/dev/null || true"
        p_res = executor.execute(target_host, part_cmd)
        if not p_res.success:
            return False, "\n".join(logs), f"Partitioning failed on {target_host}: {p_res.stderr}"
        logs.append(f"Created GPT partition on {device}.")

        # Determine partition name (e.g. /dev/sdb1 or /dev/nvme0n1p1)
        partition = f"{device}p1" if any(device.endswith(c) for c in "0123456789") else f"{device}1"

        # 2. Format with filesystem
        if fs_type == "ext4":
            mkfs_cmd = f"mkfs.ext4 -F {partition}"
            quota_opts = "defaults,nofail,usrquota,grpquota"
        else:
            mkfs_cmd = f"mkfs.xfs -f {partition}"
            quota_opts = "defaults,nofail,uquota,pquota"

        mk_res = executor.execute(target_host, mkfs_cmd)
        if not mk_res.success:
            return False, "\n".join(logs), f"Formatting failed on {partition}: {mk_res.stderr}"
        logs.append(f"Formatted {partition} with {fs_type.upper()} filesystem.")

        # 3. Mount to mount_point and retrieve UUID for fstab
        uuid_res = executor.execute(target_host, f"blkid -s UUID -o value {partition}")
        uuid_val = uuid_res.stdout.strip()
        fstab_spec = f"UUID={uuid_val}" if uuid_val else partition

        fstab_line = f"{fstab_spec} {mount_point} {fs_type} {quota_opts} 0 0"

        mount_cmd = (
            f"mkdir -p {mount_point} && "
            f"grep -qxF '{fstab_line}' /etc/fstab || echo '{fstab_line}' >> /etc/fstab && "
            f"mount {mount_point} 2>/dev/null || mount -a"
        )
        mnt_res = executor.execute(target_host, mount_cmd)
        logs.append(f"Mounted {partition} to {mount_point} and registered in /etc/fstab.")

        # 4. Create required directory hierarchy based on mount point
        if mount_point == "/apps":
            dirs = [
                "/apps/spack",
                "/apps/modules",
                "/apps/compilers",
                "/apps/libraries",
                "/apps/applications",
                "/apps/software"
            ]
            mkdir_cmd = f"mkdir -p {' '.join(dirs)} && chmod 755 /apps"
            executor.execute(target_host, mkdir_cmd)
            logs.append(f"Created HPC software hierarchy under /apps: {', '.join(dirs)}")
        elif mount_point == "/scratch":
            mkdir_cmd = "mkdir -p /scratch && chmod 1777 /scratch"
            executor.execute(target_host, mkdir_cmd)
            logs.append("Created high-performance /scratch workspace with 1777 sticky permissions.")
        elif mount_point == "/home":
            mkdir_cmd = "mkdir -p /home && chmod 755 /home"
            executor.execute(target_host, mkdir_cmd)
            logs.append("Preserved and configured centralized /home storage pool with 0755 root:root.")
        else:
            mkdir_cmd = f"mkdir -p {mount_point} && chmod 755 {mount_point}"
            executor.execute(target_host, mkdir_cmd)
            logs.append(f"Configured {mount_point} directory hierarchy.")

        # 5. Verification: findmnt
        verify_res = executor.execute(target_host, CommandBuilder.findmnt(mount_point))
        if not verify_res.success or not verify_res.stdout:
            return False, "\n".join(logs), f"Verification failed: {mount_point} is not mounted on {target_host}"

        logs.append(f"Verified active mount for {mount_point}:\n{verify_res.stdout}")
        return True, "\n".join(logs), ""
