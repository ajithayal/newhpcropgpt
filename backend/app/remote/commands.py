import shlex
from typing import Optional, Tuple

class CommandBuilder:
    @staticmethod
    def user_id(username: str) -> str:
        return f"id -u {shlex.quote(username)}"

    @staticmethod
    def user_getent(username: str) -> str:
        return f"getent passwd {shlex.quote(username)}"

    @staticmethod
    def user_create(username: str, uid: int, gid: int, home: str, shell: str = "/bin/bash") -> str:
        return f"useradd -u {uid} -g {gid} -d {shlex.quote(home)} -s {shlex.quote(shell)} -m {shlex.quote(username)}"

    @staticmethod
    def user_update(username: str, home: Optional[str] = None, shell: Optional[str] = None, uid: Optional[int] = None, gid: Optional[int] = None) -> str:
        flags = []
        if home:
            flags.append(f"-d {shlex.quote(home)}")
        if shell:
            flags.append(f"-s {shlex.quote(shell)}")
        if uid:
            flags.append(f"-u {uid}")
        if gid:
            flags.append(f"-g {gid}")
        if not flags:
            return "true"
        return f"usermod {' '.join(flags)} {shlex.quote(username)}"

    @staticmethod
    def user_delete(username: str, remove_home: bool = False) -> str:
        flag = "-r" if remove_home else ""
        return f"userdel {flag} {shlex.quote(username)}"

    @staticmethod
    def user_chpasswd(username: str, password: str) -> Tuple[str, str]:
        # Uses stdin to avoid logging passwords or showing them in 'ps'
        return "chpasswd", f"{username}:{password}\n"

    @staticmethod
    def dir_ensure(path: str, uid: int, gid: int, mode: str = "700", copy_skel: bool = False) -> str:
        q_path = shlex.quote(path)
        cmds = [
            f"mkdir -p {q_path}",
            f"chmod {shlex.quote(mode)} {q_path}",
            f"chown {uid}:{gid} {q_path}",
        ]
        if copy_skel:
            cmds.append(f"if [ -d /etc/skel ]; then cp -rn /etc/skel/. {q_path}/ 2>/dev/null || true; chown -R {uid}:{gid} {q_path}; fi")
        return " && ".join(cmds)

    @staticmethod
    def quota_apply_xfs(target: int, filesystem: str, soft_gb: int, hard_gb: int, is_user: bool = True) -> str:
        flag = "bsoft"
        target_flag = f"-u {target}" if is_user else f"-p {target}"
        return f"xfs_quota -x -c 'limit bsoft={soft_gb}g bhard={hard_gb}g {target}' {shlex.quote(filesystem)}"

    @staticmethod
    def quota_report_xfs(filesystem: str) -> str:
        return f"xfs_quota -x -c 'report -h' {shlex.quote(filesystem)}"

    @staticmethod
    def findmnt(mountpoint: str) -> str:
        return f"findmnt -P {shlex.quote(mountpoint)}"

    @staticmethod
    def exportfs_apply(export_line: str, config_path: str = "/etc/exports.d/ajicorehpc-apps.exports") -> str:
        q_cfg = shlex.quote(config_path)
        return (
            f"mkdir -p /etc/exports.d && "
            f"echo {shlex.quote(export_line)} > {q_cfg} && "
            f"exportfs -ra"
        )

    @staticmethod
    def exportfs_verify() -> str:
        return "exportfs -v"

    @staticmethod
    def firewall_nfs() -> str:
        return (
            "firewall-cmd --permanent --add-service=nfs --add-service=rpc-bind --add-service=mountd 2>/dev/null && "
            "firewall-cmd --reload 2>/dev/null || true"
        )

    @staticmethod
    def acl_set(path: str, group: str, permissions: str = "r-x") -> str:
        q_path = shlex.quote(path)
        return f"setfacl -R -m g:{shlex.quote(group)}:{shlex.quote(permissions)} {q_path} && setfacl -R -d -m g:{shlex.quote(group)}:{shlex.quote(permissions)} {q_path}"

    @staticmethod
    def acl_get(path: str) -> str:
        return f"getfacl {shlex.quote(path)}"
