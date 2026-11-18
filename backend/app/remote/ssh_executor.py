import os
import socket
import time
import logging
from typing import Optional, Tuple, Dict, Any
import paramiko

logger = logging.getLogger("ajicorehpc.remote.ssh")

class SSHResult:
    def __init__(self, exit_code: int, stdout: str, stderr: str, duration_ms: float = 0.0):
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.duration_ms = duration_ms

    @property
    def success(self) -> bool:
        return self.exit_code == 0

    def __repr__(self):
        return f"<SSHResult exit={self.exit_code} stdout={len(self.stdout)}b stderr={len(self.stderr)}b>"


class BaseSSHExecutor:
    """Base class for SSH execution so test harness can inject a FakeSSHExecutor."""
    def execute(self, host: str, command: str, stdin_data: Optional[str] = None, timeout: float = 15.0) -> SSHResult:
        raise NotImplementedError

    def test_connection(self, host: str, timeout: float = 3.0) -> Tuple[bool, float, Optional[str]]:
        raise NotImplementedError


class SSHExecutor(BaseSSHExecutor):
    """Production Paramiko SSH Executor."""

    def __init__(
        self,
        default_user: str = "root",
        default_password: Optional[str] = None,
        default_port: int = 22,
        key_filename: Optional[str] = None,
    ):
        self.default_user = os.getenv("AJICOREHPC_SSH_USER") or os.getenv("NODE_SSH_USER") or default_user
        self.default_password = os.getenv("AJICOREHPC_SSH_PASSWORD") or os.getenv("NODE_SSH_PASSWORD") or default_password or ""
        self.default_port = int(os.getenv("AJICOREHPC_SSH_PORT") or default_port)
        self.key_filename = key_filename

    def _get_credentials(self, host: str) -> Tuple[str, str, int]:
        # Can be enhanced to look up per-node credentials in DB
        return self.default_user, self.default_password, self.default_port

    def test_tcp_reachability(self, host: str, port: int = 22, timeout: float = 2.0) -> Tuple[bool, float]:
        """Fast socket test for port reachability."""
        start = time.perf_counter()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        try:
            res = sock.connect_ex((host, port))
            latency = (time.perf_counter() - start) * 1000.0
            return (res == 0, latency)
        except Exception:
            return (False, 0.0)
        finally:
            sock.close()

    def test_connection(self, host: str, timeout: float = 5.0) -> Tuple[bool, float, Optional[str]]:
        """
        Tests both TCP port 22 connectivity and SSH authentication with `true`.
        Returns (online, latency_ms, error_message).
        """
        # Step 1: Fast TCP socket check
        tcp_ok, latency = self.test_tcp_reachability(host, self.default_port, timeout=min(timeout, 2.0))
        if not tcp_ok:
            return False, latency, f"TCP connection refused or timed out on port {self.default_port}"

        # Step 2: SSH auth check with 'true'
        res = self.execute(host, "true", timeout=timeout)
        if res.success:
            return True, latency, None
        return False, latency, res.stderr or f"SSH handshake or auth failed (exit {res.exit_code})"

    def execute(
        self,
        host: str,
        command: str,
        stdin_data: Optional[str] = None,
        timeout: float = 25.0,
        user: Optional[str] = None,
        password: Optional[str] = None,
        port: Optional[int] = None,
    ) -> SSHResult:
        if not host:
            return SSHResult(-1, "", "Target host IP or hostname not specified", 0.0)

        u, p, def_port = self._get_credentials(host)
        user = user or u
        password = password if password is not None else p
        port = port or def_port

        start = time.perf_counter()
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            connect_kwargs: Dict[str, Any] = {
                "hostname": host,
                "port": port,
                "username": user,
                "timeout": min(timeout, 8.0),
                "banner_timeout": min(timeout, 8.0),
                "look_for_keys": False,
                "allow_agent": False,
            }
            if password:
                connect_kwargs["password"] = password
            if self.key_filename and os.path.exists(self.key_filename):
                connect_kwargs["key_filename"] = self.key_filename

            client.connect(**connect_kwargs)

            stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            if stdin_data:
                stdin.write(stdin_data)
                stdin.flush()
                stdin.channel.shutdown_write()

            out = stdout.read().decode("utf-8", errors="replace").strip()
            err = stderr.read().decode("utf-8", errors="replace").strip()
            exit_code = stdout.channel.recv_exit_status()
            duration = (time.perf_counter() - start) * 1000.0

            return SSHResult(exit_code, out, err, duration)

        except Exception as e:
            duration = (time.perf_counter() - start) * 1000.0
            return SSHResult(-1, "", str(e), duration)
        finally:
            try:
                client.close()
            except Exception:
                pass


# Global singleton instance
_default_executor: BaseSSHExecutor = SSHExecutor()

def get_ssh_executor() -> BaseSSHExecutor:
    global _default_executor
    return _default_executor

def set_ssh_executor(executor: BaseSSHExecutor) -> None:
    """Used by test suites to inject FakeSSHExecutor."""
    global _default_executor
    _default_executor = executor
