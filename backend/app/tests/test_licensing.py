import base64
import json
import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

import app.core.licensing as licensing_module
from app.core.licensing import (
    get_system_installation_id,
    extract_raw_token,
    verify_license_token,
)


def test_installation_id_format():
    """Installation ID must follow AYAL-INST-<12-hex-hash> (or legacy AJICORE-INST-)."""
    inst_id = get_system_installation_id()
    assert inst_id.startswith("AYAL-INST-") or inst_id.startswith("AJICORE-INST-")
    assert len(inst_id) == len("AYAL-INST-") + 12


def test_extract_raw_token():
    """Extracts raw token payload from armored blocks or raw tokens."""
    raw = "AJICORE-abc123payload.sig456"
    assert extract_raw_token(raw) == "abc123payload.sig456"

    # Legacy token tolerance
    legacy_raw = "AYAL-abc123payload.sig456"
    assert extract_raw_token(legacy_raw) == "abc123payload.sig456"

    # Armored block
    armored = (
        "-----BEGIN AJICOREHPC LICENSE-----\n"
        "AJICORE-xyz789.sig000\n"
        "-----END AJICOREHPC LICENSE-----"
    )
    assert extract_raw_token(armored) == "xyz789.sig000"


def test_issue_and_verify_perpetual_license(monkeypatch):
    """Issues genuine perpetual license with Ed25519 and verifies cryptographic signature."""
    # Generate ephemeral test Ed25519 keypair
    test_priv_key = ed25519.Ed25519PrivateKey.generate()
    monkeypatch.setattr(licensing_module, "get_public_key", lambda: test_priv_key.public_key())

    inst_id = get_system_installation_id()
    cust_id = "AJICORE-CUST-202611-0042"
    email = "admin@cluster.enterprise.org"

    # Construct canonical payload
    payload = {
        "version": "1.0",
        "customer_id": cust_id,
        "customer_email": email,
        "organization": "Enterprise Cluster Org",
        "installation_id": inst_id,
        "license_type": "PERPETUAL",
        "plan": "ENTERPRISE",
        "max_nodes": 64,
        "max_clusters": 5,
        "features": ["all"],
        "issued_at": "2026-11-02T12:00:00Z",
        "expires_at": None,
    }

    canonical_json = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode("utf-8")
    signature = test_priv_key.sign(canonical_json)

    b64_payload = base64.urlsafe_b64encode(canonical_json).decode("ascii").rstrip("=")
    b64_sig = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")

    token = f"AJICORE-{b64_payload}.{b64_sig}"

    is_valid, verified_payload, msg = verify_license_token(
        token_input=token,
        expected_customer_id=cust_id,
        expected_email=email,
        enforce_installation_binding=True,
    )

    assert is_valid is True
    assert verified_payload is not None
    assert verified_payload["is_perpetual"] is True
    assert verified_payload["expires_at"] is None
    assert verified_payload["max_nodes"] == 64
    assert "License verified successfully" in msg


def test_legacy_license_and_installation_id_tolerance(monkeypatch):
    """Verifies that an old AYAL- license bound to AYAL-INST- matches an AJICORE-INST- server."""
    test_priv_key = ed25519.Ed25519PrivateKey.generate()
    monkeypatch.setattr(licensing_module, "get_public_key", lambda: test_priv_key.public_key())

    curr_inst_id = get_system_installation_id()  # e.g. AJICORE-INST-B32D0678F12A
    hash_suffix = curr_inst_id.replace("AJICORE-INST-", "")
    legacy_inst_id = f"AYAL-INST-{hash_suffix}"

    cust_id = "AYAL-CUST-202610-8842"
    email = "admin@legacy.org"

    payload = {
        "version": "1.0",
        "customer_id": cust_id,
        "customer_email": email,
        "organization": "Legacy Ayal Customer",
        "installation_id": legacy_inst_id,
        "license_type": "PERPETUAL",
        "plan": "ENTERPRISE",
        "max_nodes": 32,
        "issued_at": "2026-10-01T00:00:00Z",
    }

    canonical_json = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode("utf-8")
    sig = test_priv_key.sign(canonical_json)
    b64_p = base64.urlsafe_b64encode(canonical_json).decode("ascii").rstrip("=")
    b64_s = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")
    legacy_token = f"AYAL-{b64_p}.{b64_s}"

    # Verify with modern expectations -> must succeed thanks to prefix tolerance
    is_valid, verified_payload, msg = verify_license_token(
        token_input=legacy_token,
        expected_customer_id="AJICORE-CUST-202610-8842",
        expected_email=email,
        enforce_installation_binding=True,
    )

    assert is_valid is True
    assert verified_payload["is_perpetual"] is True
    assert "License verified successfully" in msg
