"""
AYAL HPC Manager — Secure Credential Cryptography Service
Provides authenticated AES encryption/decryption for remote SSH node credentials,
API tokens, and sensitive infrastructure secrets using Cryptography Fernet.
"""
import os
import json
import base64
import hashlib
import logging
from typing import Optional, Tuple, Dict, Any
from cryptography.fernet import Fernet, InvalidToken
from app.core.config import settings

logger = logging.getLogger("ayalhpc.security_crypto")


def _get_encryption_key() -> bytes:
    """
    Derives a 32-byte URL-safe base64 key from settings.SECRET_KEY or AYALHPC_ENCRYPTION_KEY.
    Guarantees deterministic encryption key across application restarts.
    """
    custom_key = os.getenv("AYALHPC_ENCRYPTION_KEY") or os.getenv("ENCRYPTION_KEY")
    if custom_key:
        raw = custom_key.strip().encode("utf-8")
    else:
        raw = (settings.SECRET_KEY or "ayalhpc-production-secret-encryption-key-2026").encode("utf-8")

    digest = hashlib.sha256(raw).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: str) -> str:
    """Encrypts a plaintext string into a base64-encoded encrypted token."""
    if not plaintext:
        return ""
    try:
        f = Fernet(_get_encryption_key())
        return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.error(f"[Crypto] Encryption failed: {e}")
        raise ValueError("Failed to encrypt sensitive secret") from e


def decrypt_secret(token: str) -> str:
    """Decrypts a base64-encoded token back into plaintext."""
    if not token:
        return ""
    try:
        f = Fernet(_get_encryption_key())
        return f.decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("[Crypto] Invalid encryption token or secret key mismatch")
        return ""
    except Exception as e:
        logger.error(f"[Crypto] Decryption failed: {e}")
        return ""


def encrypt_node_credentials(
    username: str = "root",
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    port: int = 22,
) -> str:
    """Serializes and encrypts SSH node authentication parameters into an encrypted token."""
    payload = {
        "user": username or "root",
        "password": password or "",
        "key": private_key or "",
        "port": int(port or 22),
    }
    return encrypt_secret(json.dumps(payload))


def decrypt_node_credentials(token: str) -> Dict[str, Any]:
    """Decrypts and parses node authentication token into a dictionary."""
    if not token:
        return {"user": "root", "password": "", "key": "", "port": 22}
    raw = decrypt_secret(token)
    if not raw:
        return {"user": "root", "password": "", "key": "", "port": 22}
    try:
        data = json.loads(raw)
        return {
            "user": data.get("user", "root"),
            "password": data.get("password") or "",
            "key": data.get("key") or "",
            "port": int(data.get("port", 22)),
        }
    except Exception as e:
        logger.error(f"[Crypto] Failed to parse decrypted credentials: {e}")
        return {"user": "root", "password": "", "key": "", "port": 22}


def attach_encrypted_credentials(
    tags: Optional[Dict[str, Any]],
    username: str = "root",
    password: Optional[str] = None,
    private_key: Optional[str] = None,
    port: int = 22,
) -> Dict[str, Any]:
    """
    Attaches encrypted SSH credentials to a node's tags dictionary under the protected
    internal key '_ssh_auth'. Plaintext credentials are never stored.
    """
    result = dict(tags or {})
    if password or private_key:
        result["_ssh_auth"] = encrypt_node_credentials(
            username=username,
            password=password,
            private_key=private_key,
            port=port,
        )
    return result


def extract_node_credentials(tags: Optional[Dict[str, Any]]) -> Tuple[str, Optional[str], Optional[str], int]:
    """
    Extracts (username, password, private_key, port) from node tags dictionary.
    Prioritizes encrypted '_ssh_auth' token; supports fallback to legacy unencrypted tags or NODE_SSH_PASSWORD env.
    """
    default_user = os.getenv("NODE_SSH_USER", "root")
    default_pass = os.getenv("NODE_SSH_PASSWORD") or None

    if not tags or not isinstance(tags, dict):
        return default_user, default_pass, None, 22

    if "_ssh_auth" in tags and tags["_ssh_auth"]:
        creds = decrypt_node_credentials(tags["_ssh_auth"])
        return (
            creds.get("user") or default_user,
            creds.get("password") or default_pass,
            creds.get("key") or None,
            creds.get("port") or 22,
        )

    # Legacy fallback if unencrypted tags exist
    user = tags.get("ssh_user") or default_user
    password = tags.get("ssh_password") or tags.get("password") or default_pass
    key = tags.get("ssh_key") or tags.get("private_key") or None
    port = int(tags.get("ssh_port") or 22)
    return user, password, key, port


def sanitize_tags_for_client(tags: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Strips internal and security-sensitive keys (starting with '_') from tags before
    returning node information to user-facing API responses.
    """
    if not tags or not isinstance(tags, dict):
        return {}
    return {k: v for k, v in tags.items() if not k.startswith("_") and k not in ("ssh_password", "password", "ssh_key")}
