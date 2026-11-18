import pytest
from app.core.crypto import (
    encrypt_secret,
    decrypt_secret,
    encrypt_payload_dict,
    decrypt_payload_dict,
    purge_secrets_from_dict,
)


def test_fernet_encryption_roundtrip():
    """Verifies that sensitive strings are encrypted and decrypted accurately."""
    original = "SuperSecretHPC@AdminPassword2026!"
    cipher = encrypt_secret(original)

    assert cipher != original
    assert cipher.startswith("enc::gAAAAA")  # Fernet standard header with enc:: prefix

    decrypted = decrypt_secret(cipher)
    assert decrypted == original


def test_payload_dict_encryption():
    """Verifies that dictionary keys named password, secret, token are encrypted while others remain readable."""
    payload = {
        "username": "hpcadmin",
        "uid": 10001,
        "password": "ClearPassword!",
    }

    encrypted_dict = encrypt_payload_dict(payload)
    assert encrypted_dict["username"] == "hpcadmin"
    assert encrypted_dict["uid"] == 10001
    assert encrypted_dict["password"] != "ClearPassword!"
    assert encrypted_dict["password"].startswith("enc::gAAAAA")

    decrypted_dict = decrypt_payload_dict(encrypted_dict)
    assert decrypted_dict["password"] == "ClearPassword!"


def test_purge_secrets_from_dict():
    """Verifies that sensitive keys are purged to [PURGED] in memory/log payloads."""
    payload = {
        "username": "hpcadmin",
        "password": "ClearPassword!",
        "private_key": "-----BEGIN RSA PRIVATE KEY-----...",
    }

    clean = purge_secrets_from_dict(payload)
    assert clean["username"] == "hpcadmin"
    assert clean["password"] == "[PURGED]"
    assert clean["private_key"] == "[PURGED]"
