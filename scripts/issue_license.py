#!/usr/bin/env python3
"""
AjiCorehpc Manager — Vendor License Issuer CLI Tool
---------------------------------------------------
Generates asymmetrically signed (Ed25519) digital licenses for customer installations.
Supports genuine Perpetual licenses with no expiration date or time-bombs.

Usage:
    python scripts/issue_license.py --customer-id AJICORE-CUST-202610-8842 \
                                   --customer-email admin@enterprise.com \
                                   --organization "Enterprise HPC" \
                                   --installation-id AJICORE-INST-4F8B2C1A9E \
                                   --plan ENTERPRISE \
                                   --type PERPETUAL \
                                   --max-nodes 128
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

DEFAULT_PRIV_KEY_PATH = Path(__file__).resolve().parent / "vendor_private_key.pem"


def load_private_key(key_path: Path) -> ed25519.Ed25519PrivateKey:
    if not key_path.exists():
        print(f"Error: Vendor private key not found at {key_path}")
        print("Run key generation script or provide --key argument.")
        sys.exit(1)
    with open(key_path, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)


def issue_license(
    customer_id: str,
    customer_email: str,
    organization: str,
    installation_id: str = "*",
    plan: str = "ENTERPRISE",
    license_type: str = "PERPETUAL",
    max_nodes: int = 128,
    max_clusters: int = 5,
    features: list[str] = None,
    key_path: Path = DEFAULT_PRIV_KEY_PATH,
) -> dict:
    priv_key = load_private_key(key_path)

    if features is None:
        features = [
            "cluster_management",
            "slurm_workload_manager",
            "bmc_idrac_ilo_management",
            "nfs_storage_orchestration",
            "automated_backup_recovery",
            "power_ups_monitoring",
            "freeipa_identity_management",
            "unlimited_user_accounts"
        ]

    issued_at = datetime.now(timezone.utc).isoformat()

    # Construct canonical license payload
    # Note: For PERPETUAL licenses, expires_at is explicitly None / omitted to guarantee indefinite validity
    payload = {
        "version": "1.0",
        "customer_id": customer_id.strip().upper(),
        "customer_email": customer_email.strip().lower(),
        "organization": organization.strip(),
        "installation_id": installation_id.strip(),
        "license_type": license_type.strip().upper(),
        "plan": plan.strip().upper(),
        "max_nodes": int(max_nodes),
        "max_clusters": int(max_clusters),
        "features": features,
        "issued_at": issued_at,
        "expires_at": None if license_type.upper() == "PERPETUAL" else None
    }

    canonical_json = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode("utf-8")
    signature = priv_key.sign(canonical_json)

    # Encode payload and signature
    b64_payload = base64.urlsafe_b64encode(canonical_json).decode("ascii").rstrip("=")
    b64_sig = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")

    license_token = f"AJICORE-{b64_payload}.{b64_sig}"

    # Formatted armored block
    armored_block = (
        "-----BEGIN AJICOREHPC LICENSE-----\n"
        f"{license_token}\n"
        "-----END AJICOREHPC LICENSE-----"
    )

    return {
        "payload": payload,
        "token": license_token,
        "armored_block": armored_block
    }


def main():
    parser = argparse.ArgumentParser(description="AjiCorehpc Manager — Vendor License Issuer")
    parser.add_argument("--customer-id", required=True, help="Customer ID, e.g. AJICORE-CUST-202610-8842")
    parser.add_argument("--customer-email", required=True, help="Registered administrator email")
    parser.add_argument("--organization", required=True, help="Organization / Company name")
    parser.add_argument("--installation-id", default="*", help="Installation ID to bind, or * for universal")
    parser.add_argument("--plan", default="ENTERPRISE", choices=["STANDARD", "ENTERPRISE", "ULTIMATE"], help="License Plan")
    parser.add_argument("--type", default="PERPETUAL", choices=["PERPETUAL", "SUBSCRIPTION"], help="License Type")
    parser.add_argument("--max-nodes", type=int, default=128, help="Maximum compute nodes allowed")
    parser.add_argument("--max-clusters", type=int, default=5, help="Maximum clusters allowed")
    parser.add_argument("--key", type=Path, default=DEFAULT_PRIV_KEY_PATH, help="Path to vendor private key PEM")
    parser.add_argument("--output", type=Path, help="Save license file to path")

    args = parser.parse_args()

    result = issue_license(
        customer_id=args.customer_id,
        customer_email=args.customer_email,
        organization=args.organization,
        installation_id=args.installation_id,
        plan=args.plan,
        license_type=args.type,
        max_nodes=args.max_nodes,
        max_clusters=args.max_clusters,
        key_path=args.key,
    )

    print("\n=======================================================")
    print("   AJICOREHPC MANAGER — ASYMMETRIC LICENSE ISSUED")
    print("=======================================================")
    print(f"Customer ID:     {result['payload']['customer_id']}")
    print(f"Customer Email:  {result['payload']['customer_email']}")
    print(f"Organization:    {result['payload']['organization']}")
    print(f"Installation ID: {result['payload']['installation_id']}")
    print(f"Plan Tier:       {result['payload']['plan']}")
    print(f"License Type:    {result['payload']['license_type']} (No Expiration Date)")
    print(f"Max Nodes:       {result['payload']['max_nodes']}")
    print("-------------------------------------------------------")
    print("ACTIVATION LICENSE TOKEN:")
    print(result['token'])
    print("-------------------------------------------------------")
    print(result['armored_block'])
    print("=======================================================\n")

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result['armored_block'])
        print(f"License written to {args.output}")


if __name__ == "__main__":
    main()
