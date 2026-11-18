import os
import base64
import hashlib
import json
from typing import Any, Dict
from cryptography.fernet import Fernet

SENSITIVE_KEYS = {"password", "secret", "admin_password", "private_key", "ssh_password"}
ENCRYPTED_PREFIX = "enc::"

def _derive_fernet_key() -> bytes:
    raw_key = (
        os.getenv("AJICOREHPC_SECRET_KEY")
        or os.getenv("AYALHPC_SECRET_KEY")
        or os.getenv("LAYAHPC_SECRET_KEY")
        or os.getenv("SECRET_KEY")
        or "ajicorehpc-default-reconcile-secret-key-32bytes!!"
    )
    # Derive a deterministic 32-byte key using SHA-256 and base64-encode it for Fernet
    digest = hashlib.sha256(raw_key.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)

_FERNET_INSTANCE = None

def get_fernet() -> Fernet:
    global _FERNET_INSTANCE
    if _FERNET_INSTANCE is None:
        _FERNET_INSTANCE = Fernet(_derive_fernet_key())
    return _FERNET_INSTANCE

def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    if plaintext.startswith(ENCRYPTED_PREFIX):
        return plaintext
    fernet = get_fernet()
    token = fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")
    return f"{ENCRYPTED_PREFIX}{token}"

def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    if not ciphertext.startswith(ENCRYPTED_PREFIX):
        return ciphertext
    token = ciphertext[len(ENCRYPTED_PREFIX):]
    fernet = get_fernet()
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""

def encrypt_payload_dict(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively encrypts sensitive fields in a dictionary."""
    result = {}
    for k, v in payload.items():
        if isinstance(v, dict):
            result[k] = encrypt_payload_dict(v)
        elif isinstance(v, list):
            result[k] = [
                encrypt_payload_dict(item) if isinstance(item, dict) else item
                for item in v
            ]
        elif k in SENSITIVE_KEYS and isinstance(v, str) and v:
            result[k] = encrypt_secret(v)
        else:
            result[k] = v
    return result

def decrypt_payload_dict(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively decrypts sensitive fields in a dictionary."""
    result = {}
    for k, v in payload.items():
        if isinstance(v, dict):
            result[k] = decrypt_payload_dict(v)
        elif isinstance(v, list):
            result[k] = [
                decrypt_payload_dict(item) if isinstance(item, dict) else item
                for item in v
            ]
        elif k in SENSITIVE_KEYS and isinstance(v, str) and v:
            result[k] = decrypt_secret(v)
        else:
            result[k] = v
    return result

def purge_secrets_from_dict(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Replaces sensitive fields with [PURGED]."""
    result = {}
    for k, v in payload.items():
        if isinstance(v, dict):
            result[k] = purge_secrets_from_dict(v)
        elif isinstance(v, list):
            result[k] = [
                purge_secrets_from_dict(item) if isinstance(item, dict) else item
                for item in v
            ]
        elif k in SENSITIVE_KEYS:
            result[k] = "[PURGED]"
        else:
            result[k] = v
    return result
