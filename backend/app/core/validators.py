"""
AYAL HPC Manager — Input & Network Parameter Validators
Enforces strict RFC-compliant validation for IPv4 addresses, CIDR blocks,
hostnames, and cluster identifiers to prevent malformed data and command injection.
"""
import re
import ipaddress
from typing import Optional

# Hostname RFC 1123 regex: letters, numbers, hyphens, dots; max 253 chars
HOSTNAME_REGEX = re.compile(
    r"^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*$"
)


def validate_ipv4_address(ip_str: Optional[str], field_name: str = "IP Address") -> str:
    """
    Validates that a string is a valid IPv4 address in standard dot-decimal notation.
    Raises ValueError with descriptive message if invalid.
    """
    if not ip_str or not isinstance(ip_str, str):
        raise ValueError(f"{field_name} is required and cannot be empty.")

    clean = ip_str.strip()
    # Check for exact 4 dot-separated numeric octets to reject malformed inputs like '192.9.60104'
    parts = clean.split(".")
    if len(parts) != 4:
        raise ValueError(
            f"Invalid {field_name} format: '{clean}'. Expected 4 octets separated by dots (e.g. 192.168.1.100)."
        )

    for part in parts:
        if not part.isdigit():
            raise ValueError(f"Invalid octet '{part}' in {field_name}: '{clean}'. Must be numeric.")
        if len(part) > 1 and part.startswith("0"):
            raise ValueError(f"Leading zero not allowed in octet '{part}' for {field_name}: '{clean}'.")

    try:
        addr = ipaddress.IPv4Address(clean)
        return str(addr)
    except ipaddress.AddressValueError as e:
        raise ValueError(f"Invalid {field_name} '{clean}': {e}") from e


def validate_ipv4_or_subnet(target: Optional[str], field_name: str = "Subnet/IP") -> str:
    """
    Validates either a single IPv4 address (e.g. 192.168.1.10) or CIDR subnet (e.g. 192.168.1.0/24)
    or '*' for wildcard NFS export client match.
    """
    if not target or not isinstance(target, str):
        return "*"

    clean = target.strip()
    if clean in ("*", "any", "ALL"):
        return "*"

    if "/" in clean:
        try:
            net = ipaddress.IPv4Network(clean, strict=False)
            return str(net)
        except Exception as e:
            raise ValueError(f"Invalid CIDR network '{clean}' for {field_name}: {e}") from e

    return validate_ipv4_address(clean, field_name=field_name)


def validate_cluster_hostname(hostname: Optional[str], field_name: str = "Hostname") -> str:
    """
    Validates that a hostname or FQDN complies with RFC 1123 and contains NO shell metacharacters.
    """
    if not hostname or not isinstance(hostname, str):
        raise ValueError(f"{field_name} is required and cannot be empty.")

    clean = hostname.strip().lower()
    if len(clean) > 253:
        raise ValueError(f"{field_name} exceeds maximum allowed length of 253 characters.")

    if not HOSTNAME_REGEX.match(clean):
        raise ValueError(
            f"Invalid {field_name} '{clean}'. Must contain only alphanumeric characters, hyphens, and dots."
        )

    return clean
