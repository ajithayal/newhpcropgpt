"""
AjiCorehpc Manager — Core Asymmetric Licensing Engine (Ed25519)
-------------------------------------------------------------
Verifies cryptographically signed product licenses using the vendor's embedded
Ed25519 public key. Supports genuine perpetual licenses without expiration dates.
"""

from __future__ import annotations
import base64
import hashlib
import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from typing import Optional, Tuple
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

# Embedded Vendor Master Public Key PEM
# The corresponding private key is strictly isolated to vendor release tooling
VENDOR_PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVrD833QG7fhoFHKwDOjsFOD9NxUREebLyeKrr4fF6Oo=
-----END PUBLIC KEY-----"""


def get_system_installation_id() -> str:
    """
    Computes a deterministic, hardware-anchored installation fingerprint for this host.
    Uses /etc/machine-id (Linux), system UUID, or fallback stable hardware identifiers.
    Returns AJICORE-INST-<12-hex-hash>.
    """
    raw_id = ""
    # 1. Linux machine-id
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"]:
        if os.path.exists(path):
            try:
                with open(path, "r") as f:
                    content = f.read().strip()
                    if content:
                        raw_id = content
                        break
            except Exception:
                pass

    # 2. Windows / fallback UUID
    if not raw_id:
        try:
            if platform.system() == "Windows":
                cmd = ["powershell", "-NoProfile", "-Command", "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
                if res.returncode == 0 and res.stdout.strip():
                    raw_id = res.stdout.strip()
        except Exception:
            pass

    # 3. Fallback to node identifier
    if not raw_id:
        raw_id = f"{platform.node()}-{platform.machine()}-AjiCorehpc"

    h = hashlib.sha256(raw_id.encode("utf-8")).hexdigest()[:12].upper()
    return f"AYAL-INST-{h}"


def get_public_key() -> ed25519.Ed25519PublicKey:
    return serialization.load_pem_public_key(VENDOR_PUBLIC_KEY_PEM)


def extract_raw_token(token_str: str) -> str:
    """Extracts raw token payload from armored blocks or raw strings (supports AJICORE- and legacy AYAL-)."""
    token_str = token_str.strip()
    lines = [
        line.strip() for line in token_str.splitlines()
        if not line.startswith("-----") and line.strip()
    ]
    cleaned = "".join(lines)
    if cleaned.startswith("AJICORE-"):
        return cleaned[8:]
    if cleaned.startswith("AYAL-"):
        return cleaned[5:]
    return cleaned


def verify_license_token(
    token_input: str,
    expected_customer_id: Optional[str] = None,
    expected_email: Optional[str] = None,
    enforce_installation_binding: bool = True,
) -> Tuple[bool, Optional[dict], str]:
    """
    Verifies an Ed25519 signed license token.
    Supports both AJICORE- and legacy AYAL- licenses and customer IDs.
    Returns: (is_valid, payload_dict_or_none, error_message_or_ok)
    """
    try:
        raw = extract_raw_token(token_input)
        if "." not in raw:
            return False, None, "Invalid license key format. Please enter the 26-digit key received at ajithlayatech@gmail.com."

        b64_payload, b64_sig = raw.split(".", 1)

        # Pad base64 url-safe strings
        payload_bytes = base64.urlsafe_b64decode(b64_payload + "=" * (-len(b64_payload) % 4))
        sig_bytes = base64.urlsafe_b64decode(b64_sig + "=" * (-len(b64_sig) % 4))

        # 1. Asymmetric cryptographic verification with vendor public key
        public_key = get_public_key()
        try:
            public_key.verify(sig_bytes, payload_bytes)
        except Exception as sig_err:
            return False, None, f"Cryptographic signature check failed: {str(sig_err)}"

        # 2. Parse verified payload
        payload = json.loads(payload_bytes.decode("utf-8"))

        # 3. Customer ID and email validation
        if expected_customer_id:
            cust_in_lic = payload.get("customer_id", "").strip().upper()
            norm_lic_cust = cust_in_lic.replace("AJICORE-CUST-", "").replace("AYAL-CUST-", "")
            norm_exp_cust = expected_customer_id.strip().upper().replace("AJICORE-CUST-", "").replace("AYAL-CUST-", "")
            if norm_lic_cust != norm_exp_cust:
                return False, None, f"License Customer ID ({cust_in_lic}) does not match registered Customer ID ({expected_customer_id})."

        if expected_email:
            email_in_lic = payload.get("customer_email", "").strip().lower()
            if email_in_lic != expected_email.strip().lower():
                return False, None, f"License email ({email_in_lic}) does not match registered email ({expected_email})."

        # 4. Installation ID binding (supports both AJICORE-INST- and legacy AYAL-INST-)
        lic_inst_id = payload.get("installation_id", "*")
        current_inst_id = get_system_installation_id()

        if enforce_installation_binding and lic_inst_id != "*":
            norm_lic_inst = lic_inst_id.strip().upper().replace("AJICORE-INST-", "").replace("AYAL-INST-", "")
            norm_curr_inst = current_inst_id.strip().upper().replace("AJICORE-INST-", "").replace("AYAL-INST-", "")
            if norm_lic_inst != norm_curr_inst:
                return False, None, (
                    f"License is bound to installation '{lic_inst_id}', "
                    f"which does not match this server's installation ID '{current_inst_id}'."
                )

        # 5. Perpetual check vs Subscription expiration
        lic_type = payload.get("license_type", "PERPETUAL").upper()
        if lic_type == "PERPETUAL":
            # Genuine perpetual: indefinite validity, no time expiration check
            payload["is_perpetual"] = True
            payload["expires_at"] = None
        else:
            payload["is_perpetual"] = False
            expires_at = payload.get("expires_at")
            if expires_at:
                exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if exp_dt < datetime.now(timezone.utc):
                    return False, None, f"License expired on {expires_at}."

        return True, payload, "License verified successfully."

    except Exception as e:
        return False, None, f"License validation exception: {str(e)}"
