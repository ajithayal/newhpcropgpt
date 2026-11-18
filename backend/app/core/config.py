from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path
import os
import sys
import logging
from dotenv import load_dotenv

logger = logging.getLogger("ajicorehpc.config")

# Pre-load .env from backend/ and root directories so os.environ is populated
_curr_dir = Path(__file__).resolve().parent
_backend_dir = _curr_dir.parent.parent
_root_dir = _backend_dir.parent

load_dotenv(_backend_dir / ".env")
load_dotenv(_root_dir / ".env")

# Bidirectional Backward Compatibility Env Var Translation (AYAL HPC & Legacy)
for key, value in list(os.environ.items()):
    # Map legacy AjiCore and Laya variables to canonical AYALHPC_
    for legacy_pref in ["AJICOREHPC_", "LAYAHPC_", "AJICORE_"]:
        if key.startswith(legacy_pref):
            canonical_key = "AYALHPC_" + key[len(legacy_pref):]
            if canonical_key not in os.environ:
                os.environ[canonical_key] = value
    # Map AYALHPC_ to legacy AJICOREHPC_ so existing callers never break
    if key.startswith("AYALHPC_"):
        compat_key = "AJICOREHPC_" + key[len("AYALHPC_"):]
        if compat_key not in os.environ:
            os.environ[compat_key] = value

is_windows = os.name == "nt" or sys.platform.startswith("win")
_default_db = "sqlite+aiosqlite:///ajicorehpc.db" if is_windows else "postgresql+asyncpg://ajicorehpc:ajicorehpc_secret_2026@localhost:5432/ajicorehpc"


class Settings(BaseSettings):
    DATABASE_URL: str = os.getenv(
        "AJICOREHPC_DATABASE_URL",
        os.getenv("DATABASE_URL", _default_db)
    )
    REDIS_URL: str = os.getenv(
        "AJICOREHPC_REDIS_URL",
        os.getenv("REDIS_URL", "redis://:ajicorehpc_redis_2026@localhost:6379/0")
    )
    SECRET_KEY: str = os.getenv(
        "AJICOREHPC_SECRET_KEY",
        os.getenv("SECRET_KEY", "ajicorehpc-secret-key-change-in-production")
    )
    INSTALL_PATH: str = os.getenv(
        "AJICOREHPC_INSTALL_PATH",
        os.getenv("INSTALL_PATH", str(_root_dir) if is_windows else "/opt/ajicorehpc")
    )
    CORS_ORIGINS: str = os.getenv(
        "AJICOREHPC_CORS_ORIGINS",
        os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
    )

    # Licensing
    LICENSE_SIGNING_SECRET: str = os.getenv(
        "AJICOREHPC_LICENSE_SIGNING_SECRET",
        os.getenv("LICENSE_SIGNING_SECRET", "ajicorehpc-default-secret-key-for-licensing-2026")
    )

    # LDAP / FreeIPA
    FREEIPA_LDAP_URL: str = os.getenv("AJICOREHPC_FREEIPA_LDAP_URL", os.getenv("FREEIPA_LDAP_URL", ""))
    FREEIPA_BASE_DN: str = os.getenv("AJICOREHPC_FREEIPA_BASE_DN", os.getenv("FREEIPA_BASE_DN", ""))
    FREEIPA_BIND_DN: str = os.getenv("AJICOREHPC_FREEIPA_BIND_DN", os.getenv("FREEIPA_BIND_DN", ""))
    FREEIPA_BIND_PASSWORD: str = os.getenv("AJICOREHPC_FREEIPA_BIND_PASSWORD", os.getenv("FREEIPA_BIND_PASSWORD", ""))
    FREEIPA_CA_CERT_PATH: str = os.getenv("AJICOREHPC_FREEIPA_CA_CERT_PATH", os.getenv("FREEIPA_CA_CERT_PATH", ""))
    FREEIPA_KERBEROS_REALM: str = os.getenv("AJICOREHPC_FREEIPA_KERBEROS_REALM", os.getenv("FREEIPA_KERBEROS_REALM", ""))

    # SMTP (Clean configuration: loaded exclusively from environment variables or settings)
    SMTP_HOST: str = os.getenv("AYALHPC_SMTP_HOST", os.getenv("SMTP_HOST", ""))
    SMTP_PORT: int = int(os.getenv("AYALHPC_SMTP_PORT", os.getenv("SMTP_PORT", "587")))
    SMTP_USER: str = os.getenv("AYALHPC_SMTP_USER", os.getenv("SMTP_USER", ""))
    SMTP_PASSWORD: str = os.getenv("AYALHPC_SMTP_PASSWORD", os.getenv("SMTP_PASSWORD", ""))
    SMTP_FROM: str = os.getenv("AYALHPC_SMTP_FROM", os.getenv("SMTP_FROM", ""))

    # JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"

    # Prometheus
    PROMETHEUS_URL: str = os.getenv("AJICOREHPC_PROMETHEUS_URL", os.getenv("PROMETHEUS_URL", "http://prometheus:9090"))

    @property
    def install_path(self) -> Path:
        return Path(self.INSTALL_PATH)

    @property
    def config_path(self) -> Path:
        return self.install_path / "config"

    @property
    def logs_path(self) -> Path:
        return self.install_path / "logs"

    @property
    def uploads_path(self) -> Path:
        return self.install_path / "uploads"

    @property
    def packages_path(self) -> Path:
        return self.install_path / "packages"

    @property
    def backups_path(self) -> Path:
        return self.install_path / "backups"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        extra="ignore"
    )


settings = Settings()
