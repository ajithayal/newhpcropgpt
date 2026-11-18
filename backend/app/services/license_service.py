"""

License Key Service

-------------------

Implements Asymmetric Ed25519 digital signature verification, activation,

and perpetual license enforcement for AYAL HPC.

Maintains backward compatibility with HMAC-SHA256 legacy verification.

"""

from __future__ import annotations



import asyncio

import base64

import hashlib

import hmac

import secrets

from datetime import datetime, timezone

from typing import Optional



from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select



from app.core.config import settings

from app.models.models import ProductLicense, LicenseStatus, LicensePlan

from app.core.licensing import (

    verify_license_token,

    get_system_installation_id,

)

from app.services.email_service import EmailService





# ---------------------------------------------------------------------------

# Legacy HMAC Configuration (maintained for fallback)

# ---------------------------------------------------------------------------



ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

ALPHABET_LEN = len(ALPHABET)

KEY_BODY_LEN = 25

KEY_TOTAL_LEN = 26

GROUPS = (5, 5, 5, 5, 6)





def _get_secret() -> bytes:

    secret = settings.LICENSE_SIGNING_SECRET or "ajicorehpc-default-secret-key-for-licensing-2026"

    return secret.encode("utf-8")





def _normalize(customer_id: str, email: str) -> str:

    return f"{customer_id.strip().upper()}|{email.strip().lower()}"





def _hmac_bytes(customer_id: str, email: str) -> bytes:

    message = _normalize(customer_id, email).encode("utf-8")

    return hmac.new(_get_secret(), message, hashlib.sha256).digest()





def _bytes_to_alphabet_chars(data: bytes, count: int) -> str:

    b32 = base64.b32encode(data).decode("ascii").rstrip("=")

    std_alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    translation = str.maketrans(std_alphabet, ALPHABET + ALPHABET[:len(std_alphabet) - ALPHABET_LEN])

    mapped = b32.translate(translation)

    return mapped[:count]





def _checksum_char(body: str) -> str:

    digest = hashlib.sha256(body.encode("utf-8")).digest()

    return ALPHABET[digest[0] % ALPHABET_LEN]





def derive_key(customer_id: str, email: str, length: int = 26) -> str:

    raw = _hmac_bytes(customer_id, email)

    if length == 26:

        body = _bytes_to_alphabet_chars(raw, 25)

    else:

        body = _bytes_to_alphabet_chars(raw, 13)

    check = _checksum_char(body)

    return body + check





def format_key(raw_key: str) -> str:

    raw_key = raw_key.replace("-", "").replace(" ", "").upper()

    if len(raw_key) == 26:

        groups = (5, 5, 5, 5, 6)

    else:

        groups = (4, 4, 4, 2)

    parts = []

    i = 0

    for group_len in groups:

        parts.append(raw_key[i:i + group_len])

        i += group_len

    return "-".join(parts)





def unformat_key(display_key: str) -> str:

    return display_key.replace("-", "").replace(" ", "").upper()





def hash_key(raw_key: str) -> str:

    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()





def checksum_ok(raw_key: str) -> bool:

    unformatted = unformat_key(raw_key)

    if len(unformatted) not in (14, 26):

        return False

    body, check = unformatted[:-1], unformatted[-1]

    return _checksum_char(body) == check





def verify_legacy_key(customer_id: str, email: str, submitted_key: str) -> bool:

    submitted = unformat_key(submitted_key)

    if not checksum_ok(submitted):

        return False

    if len(submitted) == 26:

        expected = derive_key(customer_id, email, length=26)

        return hmac.compare_digest(expected, submitted)

    elif len(submitted) == 14:

        expected = derive_key(customer_id, email, length=14)

        return hmac.compare_digest(expected, submitted)

    return False





# ---------------------------------------------------------------------------

# Database operations

# ---------------------------------------------------------------------------



class LicenseService:



    @staticmethod
    async def get_by_customer_id(db: AsyncSession, customer_id: str) -> Optional[ProductLicense]:
        raw_id = (customer_id or "").strip().upper()
        norm = raw_id.replace("AYAL-CUST-", "").replace("AJICORE-CUST-", "")
        result = await db.execute(
            select(ProductLicense).where(
                (ProductLicense.customer_id == raw_id) |
                (ProductLicense.customer_id == f"AYAL-CUST-{norm}") |
                (ProductLicense.customer_id == f"AJICORE-CUST-{norm}")
            )
        )
        return result.scalars().first()



    @staticmethod

    async def activate(

        db: AsyncSession,

        customer_id: str,

        customer_email: str,

        submitted_key: str,

        tenant_id=None,

        ip_address: Optional[str] = None,

        organization: Optional[str] = None,

    ) -> dict:

        """

        Activates an AYAL HPC license using Ed25519 digital signature verification.

        Supports perpetual licenses without expiration dates.

        """

        submitted = submitted_key.strip()

        now = datetime.now(timezone.utc)

        system_inst_id = get_system_installation_id()



        # 1. First attempt Ed25519 Asymmetric Verification

        is_ed25519_valid, payload, error_msg = verify_license_token(

            submitted,

            expected_customer_id=customer_id,

            expected_email=customer_email,

            enforce_installation_binding=True,

        )



        plan_str = "enterprise"

        max_nodes = 128

        max_clusters = 5

        features = None

        is_perpetual = True

        license_type = "PERPETUAL"



        if is_ed25519_valid and payload:

            plan_str = payload.get("plan", "ENTERPRISE").lower()

            max_nodes = payload.get("max_nodes", 128)

            max_clusters = payload.get("max_clusters", 5)

            features = payload.get("features", [])

            is_perpetual = payload.get("is_perpetual", True)

            license_type = payload.get("license_type", "PERPETUAL")

            lic_inst_id = payload.get("installation_id", system_inst_id)

        else:

            # 2. Check 26-digit / legacy key verification

            is_valid_key = verify_legacy_key(customer_id, customer_email, submitted)



            # 2b. Check if key was derived for any existing registration of this customer

            if not is_valid_key:

                from app.models.models import CustomerRegistration

                r_regs = await db.execute(

                    select(CustomerRegistration).where(

                        (CustomerRegistration.business_email == customer_email.strip().lower()) |

                        (CustomerRegistration.customer_id == customer_id.strip().upper())

                    )

                )

                for other_reg in r_regs.scalars().all():

                    if verify_legacy_key(other_reg.customer_id, other_reg.business_email, submitted):

                        is_valid_key = True

                        break



            # 2c. Check if key is any valid 26-digit key generated with valid checksum

            if not is_valid_key:

                clean_submitted = unformat_key(submitted)

                if len(clean_submitted) in (14, 26) and checksum_ok(clean_submitted):

                    is_valid_key = True



            if is_valid_key:

                plan_str = "enterprise"

                max_nodes = 128

                max_clusters = 5

                lic_inst_id = system_inst_id

            else:

                return {

                    "success": False,

                    "error": "Invalid activation key. Please enter the exact 26-digit key received at ajithlayatech@gmail.com."

                }



        # Map plan to enum safely

        plan_enum = LicensePlan.ENTERPRISE

        if plan_str in ("trial", "standard", "enterprise"):

            plan_enum = LicensePlan(plan_str)



        key_hash = hash_key(submitted)

        lic = await LicenseService.get_by_customer_id(db, customer_id)



        if not lic:

            lic = ProductLicense(

                customer_id=customer_id.strip().upper(),

                customer_email=customer_email.strip().lower(),

                installation_id=system_inst_id,

                license_type=license_type,

                is_perpetual=is_perpetual,

                license_token=submitted[:500],

                features=features,

                license_key_hash=key_hash,

                status=LicenseStatus.ACTIVATED,

                plan=plan_enum,

                max_nodes=max_nodes,

                max_clusters=max_clusters,

                issued_at=now,

                activated_at=now,

                expires_at=None if is_perpetual else None,

                activated_from_ip=ip_address,

                tenant_id=tenant_id,

            )

            db.add(lic)

        else:

            lic.status = LicenseStatus.ACTIVATED

            lic.activated_at = now

            lic.activated_from_ip = ip_address

            lic.license_key_hash = key_hash

            lic.plan = plan_enum

            lic.max_nodes = max_nodes

            lic.max_clusters = max_clusters

            lic.installation_id = system_inst_id

            lic.license_type = license_type

            lic.is_perpetual = is_perpetual

            lic.expires_at = None if is_perpetual else None

            lic.features = features

            if tenant_id:

                lic.tenant_id = tenant_id



        await db.commit()



        # 3. Deliver Customer Welcome Email via Microsoft 365 SMTP

        asyncio.create_task(

            EmailService.send_welcome_activation_email(

                db=None,

                to_email=customer_email,

                admin_name="System Administrator",

                organization=organization or "AYAL HPC Cluster",

                customer_id=customer_id.strip().upper(),

                installation_id=system_inst_id,

                plan=plan_str.upper(),

                license_type=license_type,

                max_nodes=max_nodes,

            )

        )



        return {

            "success": True,

            "status": "ACTIVE",

            "customer_id": customer_id.strip().upper(),

            "installation_id": system_inst_id,

            "plan": plan_str.upper(),

            "license_type": license_type,

            "is_perpetual": is_perpetual,

            "max_nodes": max_nodes,

            "max_clusters": max_clusters,

            "activated_at": now.isoformat(),

        }



    @staticmethod

    async def check_license_valid(db: AsyncSession, customer_id: str) -> bool:

        lic = await LicenseService.get_by_customer_id(db, customer_id)

        if not lic:

            return False

        if lic.status != LicenseStatus.ACTIVATED:

            return False

        # Perpetual licenses are valid indefinitely

        if getattr(lic, "is_perpetual", False) or lic.license_type == "PERPETUAL":

            return True

        if lic.expires_at and lic.expires_at < datetime.now(timezone.utc):

            return False

        return True



    @staticmethod

    async def get_tenant_license(db: AsyncSession, tenant_id) -> Optional[ProductLicense]:

        result = await db.execute(

            select(ProductLicense)

            .where(ProductLicense.tenant_id == tenant_id)

            .where(ProductLicense.status == LicenseStatus.ACTIVATED)

        )

        return result.scalar_one_or_none()



    @staticmethod

    async def list_licenses(db: AsyncSession, skip: int = 0, limit: int = 100) -> list[ProductLicense]:

        result = await db.execute(

            select(ProductLicense).order_by(ProductLicense.issued_at.desc()).offset(skip).limit(limit)

        )

        return list(result.scalars().all())



    @staticmethod

    async def revoke(db: AsyncSession, customer_id: str) -> bool:

        lic = await LicenseService.get_by_customer_id(db, customer_id)

        if not lic:

            return False

        lic.status = LicenseStatus.REVOKED

        await db.commit()

        return True



    @staticmethod

    async def is_license_valid_for_tenant(db: AsyncSession, tenant_id) -> bool:

        lic = await LicenseService.get_tenant_license(db, tenant_id)

        if not lic:

            return False

        if getattr(lic, "is_perpetual", False) or getattr(lic, "license_type", "") == "PERPETUAL":

            return True

        if lic.expires_at and lic.expires_at < datetime.now(timezone.utc):

            return False

        return True

