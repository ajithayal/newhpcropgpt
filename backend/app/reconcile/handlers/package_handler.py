import logging
from typing import Dict, Any, Tuple
from app.remote.ssh_executor import get_ssh_executor

logger = logging.getLogger("ajicorehpc.reconcile.handlers.package")


class PackageReconcileHandler:
    @staticmethod
    def apply(target_host: str, op_type: str, payload: Dict[str, Any]) -> Tuple[bool, str, str]:
        executor = get_ssh_executor()
        logs = []

        pkg_name = payload.get("package_name") or payload.get("name")
        if not pkg_name:
            return False, "", "Package name missing in operation payload"

        if op_type == "package_install":
            install_cmd = f"dnf install -y {pkg_name}"
            res = executor.execute(target_host, install_cmd, timeout=180.0)
            if not res.success:
                err = f"dnf install failed for {pkg_name} on {target_host}: {res.stderr}"
                return False, "\n".join(logs), err
            logs.append(f"Installed {pkg_name} on {target_host}.")

            # Verification: rpm -q
            verify_res = executor.execute(target_host, f"rpm -q {pkg_name}")
            if not verify_res.success:
                return False, "\n".join(logs), f"Verification failed: rpm -q {pkg_name} failed on {target_host}"
            logs.append(f"Verified package installation: {verify_res.stdout}")
            return True, "\n".join(logs), ""

        return False, "", f"Unsupported package operation type: {op_type}"
