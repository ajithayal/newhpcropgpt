import asyncio
import os
import sys
from pathlib import Path
import pytest
import pytest_asyncio
from typing import Dict, Tuple, Optional, Any, List

# Ensure both backend/ and project root are on sys.path
TEST_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TEST_DIR.parent.parent
ROOT_DIR = BACKEND_DIR.parent

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.models import Base
from app.remote.ssh_executor import BaseSSHExecutor, SSHResult, set_ssh_executor


class FakeSSHExecutor(BaseSSHExecutor):
    """
    Mock SSH executor for unit tests that simulates remote node responses
    without making real network connections.
    """
    def __init__(self):
        self.commands_executed: List[Tuple[str, str, Optional[str]]] = []
        self.host_online_map: Dict[str, bool] = {
            "10.0.1.10": True,
            "10.0.1.20": True,
            "master.local": True,
            "worker.local": True,
            "offline.node": False,
        }
        self.custom_responses: Dict[str, SSHResult] = {}

    def set_host_online(self, host: str, online: bool):
        self.host_online_map[host] = online

    def set_response(self, cmd_pattern: str, result: SSHResult):
        self.custom_responses[cmd_pattern] = result

    def test_connection(self, host: str, timeout: float = 3.0) -> Tuple[bool, float, Optional[str]]:
        online = self.host_online_map.get(host, True)
        if online:
            return True, 0.5, None
        return False, 0.0, f"Host {host} is unreachable or connection refused"

    def execute(
        self,
        host: str,
        command: str,
        stdin_data: Optional[str] = None,
        timeout: float = 15.0,
        **kwargs
    ) -> SSHResult:
        self.commands_executed.append((host, command, stdin_data))

        # Check for custom mocked response
        for pattern, res in self.custom_responses.items():
            if pattern in command:
                return res

        # Default intelligent simulations for standard commands
        if "id -u" in command:
            # Check if user exists: by default say no (exit 1) unless custom set
            return SSHResult(1, "", "no such user", 1.0)

        if "getent passwd" in command:
            parts = command.split()
            username = parts[-1].strip("'\"")
            return SSHResult(0, f"{username}:x:10001:10001::/home/{username}:/bin/bash", "", 1.0)

        if "exportfs -v" in command:
            return SSHResult(0, "/apps *(rw,sync,no_root_squash,no_subtree_check)", "", 1.0)

        if "findmnt" in command:
            return SSHResult(0, 'TARGET="/apps" SOURCE="/dev/sdb1" FSTYPE="xfs" OPTIONS="rw,relatime"', "", 1.0)

        if "lsblk -J" in command:
            return SSHResult(0, '{"blockdevices":[{"name":"sdb","path":"/dev/sdb","size":"1T","type":"disk"}]}', "", 1.0)

        if "blkid" in command:
            return SSHResult(0, "e4b2d184-7a1b-419b-8e12-c4e519283f01", "", 1.0)

        # Default success
        return SSHResult(0, "success", "", 1.0)


@pytest.fixture(autouse=True)
def fake_ssh():
    fake = FakeSSHExecutor()
    set_ssh_executor(fake)
    return fake


@pytest_asyncio.fixture
async def test_db():
    """In-memory SQLite async database for clean isolation per test."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with session_maker() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()
