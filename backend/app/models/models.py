from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, ForeignKey,
    Enum as SAEnum, Table, UniqueConstraint, Index, JSON, CHAR, TypeDecorator,
    Float, BigInteger,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB as PG_JSONB
from sqlalchemy.orm import relationship
import uuid
import enum

class GUID(TypeDecorator):
    """Platform-independent GUID/UUID type.
    Uses PostgreSQL's UUID type, otherwise uses CHAR(36), storing as stringified hex.
    """
    impl = CHAR(36)
    cache_ok = True

    def __init__(self, as_uuid=True, *args, **kwargs):
        self.as_uuid = as_uuid
        super().__init__()

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(PG_UUID(as_uuid=self.as_uuid))
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return value
        else:
            if not isinstance(value, uuid.UUID):
                try:
                    return str(uuid.UUID(str(value)))
                except Exception:
                    return str(value)
            else:
                return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        else:
            if not isinstance(value, uuid.UUID):
                try:
                    return uuid.UUID(str(value))
                except Exception:
                    return value
            return value

UUID = GUID
JSONB = JSON

from app.core.database import Base


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    TENANT_ADMIN = "tenant_admin"
    CLUSTER_ADMIN = "cluster_admin"
    OPERATOR = "operator"
    RESEARCHER = "researcher"
    VIEWER = "viewer"


class LicenseStatus(str, enum.Enum):
    ISSUED = "issued"
    ACTIVATED = "activated"
    SUSPENDED = "suspended"
    EXPIRED = "expired"
    REVOKED = "revoked"


class LicensePlan(str, enum.Enum):
    TRIAL = "trial"
    STANDARD = "standard"
    ENTERPRISE = "enterprise"


# ---------------------------------------------------------------------------
# Association tables
# ---------------------------------------------------------------------------

user_roles_table = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("tenant_id", UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
)

role_permissions_table = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", UUID(as_uuid=True), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", UUID(as_uuid=True), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


# ---------------------------------------------------------------------------
# Multi-Tenancy
# ---------------------------------------------------------------------------

class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    short_name = Column(String(100), nullable=False, unique=True)
    organization_type = Column(String(100), nullable=True)
    industry = Column(String(100), nullable=True)
    website = Column(String(500), nullable=True)
    email = Column(String(255), nullable=False)
    phone = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    country = Column(String(100), nullable=True)
    pin_zip = Column(String(20), nullable=True)
    timezone = Column(String(50), default="UTC")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    users = relationship("User", back_populates="tenant")
    licenses = relationship("ProductLicense", back_populates="tenant")
    clusters = relationship("Cluster", back_populates="tenant")


# ---------------------------------------------------------------------------
# Licensing (Product License — distinct from HPC software licenses)
# ---------------------------------------------------------------------------

class ProductLicense(Base):
    __tablename__ = "product_licenses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True)
    customer_id = Column(String(100), nullable=False, unique=True, index=True)
    customer_email = Column(String(255), nullable=False)
    installation_id = Column(String(100), nullable=True, index=True)
    license_type = Column(String(50), default="PERPETUAL", nullable=False)
    is_perpetual = Column(Boolean, default=True, nullable=False)
    license_token = Column(Text, nullable=True)
    license_signature = Column(Text, nullable=True)
    features = Column(JSONB, nullable=True)
    license_key_hash = Column(String(255), nullable=False)
    status = Column(SAEnum(LicenseStatus), default=LicenseStatus.ISSUED, nullable=False)
    plan = Column(SAEnum(LicensePlan), default=LicensePlan.STANDARD)
    max_nodes = Column(Integer, nullable=True)
    max_clusters = Column(Integer, default=1)
    issued_at = Column(DateTime, default=datetime.utcnow)
    activated_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    activated_from_ip = Column(String(45), nullable=True)
    notes = Column(Text, nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="licenses")

    __table_args__ = (
        Index("ix_product_licenses_customer", "customer_id", "customer_email"),
        Index("ix_product_licenses_inst", "installation_id"),
    )


# ---------------------------------------------------------------------------
# Customer Registration & Onboarding
# ---------------------------------------------------------------------------

class CustomerRegistration(Base):
    __tablename__ = "customer_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    customer_id = Column(String(100), unique=True, nullable=False, index=True)
    installation_id = Column(String(100), nullable=False, index=True)
    organization_name = Column(String(255), nullable=False)
    admin_name = Column(String(255), nullable=False)
    business_email = Column(String(255), nullable=False, index=True)
    phone = Column(String(50), nullable=False)
    country = Column(String(100), nullable=False)
    city = Column(String(100), nullable=False)
    address = Column(Text, nullable=True)
    is_email_verified = Column(Boolean, default=False, nullable=False)
    verification_token_hash = Column(String(255), nullable=True)
    verification_pin = Column(String(10), nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="PENDING_VERIFICATION", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    verified_at = Column(DateTime, nullable=True)
    activated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_customer_reg_status", "status"),
        Index("ix_customer_reg_email", "business_email"),
    )


# ---------------------------------------------------------------------------
# RBAC
# ---------------------------------------------------------------------------

class Permission(Base):
    __tablename__ = "permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    codename = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    category = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)

    roles = relationship("Role", secondary=role_permissions_table, back_populates="permissions")


class Role(Base):
    __tablename__ = "roles"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False)
    display_name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    is_system = Column(Boolean, default=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    permissions = relationship("Permission", secondary=role_permissions_table, back_populates="roles")
    users = relationship("User", secondary=user_roles_table, back_populates="assigned_roles")

    __table_args__ = (
        UniqueConstraint("name", "tenant_id", name="uq_role_name_tenant"),
    )


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    username = Column(String(100), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=True)
    full_name = Column(String(255), nullable=True)
    role = Column(SAEnum(UserRole), default=UserRole.RESEARCHER, nullable=False)
    is_active = Column(Boolean, default=True)
    is_local = Column(Boolean, default=True)
    is_2fa_enabled = Column(Boolean, default=False)
    totp_secret = Column(String(32), nullable=True)
    ssh_public_key = Column(Text, nullable=True)
    freeipa_uid = Column(String(100), nullable=True)
    freeipa_gid = Column(Integer, nullable=True)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id"), nullable=True)
    quota_storage_gb = Column(Integer, default=100)
    quota_core_hours = Column(Integer, default=1000)
    quota_max_jobs = Column(Integer, default=100)
    last_login = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    assigned_roles = relationship("Role", secondary=user_roles_table, back_populates="users")

    __table_args__ = (
        UniqueConstraint("username", "tenant_id", name="uq_user_username_tenant"),
        Index("ix_users_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

class Group(Base):
    __tablename__ = "groups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    freeipa_gid = Column(Integer, nullable=True)
    quota_storage_gb = Column(Integer, default=1000)
    quota_core_hours = Column(Integer, default=10000)
    created_at = Column(DateTime, default=datetime.utcnow)
    users = relationship("User", backref="group")

    __table_args__ = (
        UniqueConstraint("name", "tenant_id", name="uq_group_name_tenant"),
        Index("ix_groups_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Clusters & Nodes
# ---------------------------------------------------------------------------

class Cluster(Base):
    __tablename__ = "clusters"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    scheduler_type = Column(String(50), default="slurm")
    total_nodes = Column(Integer, default=0)
    status = Column(String(50), default="active")
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    tenant = relationship("Tenant", back_populates="clusters")
    nodes = relationship("Node", back_populates="cluster")

    __table_args__ = (
        Index("ix_clusters_tenant", "tenant_id"),
    )


class Node(Base):
    __tablename__ = "nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="SET NULL"), nullable=True)
    hostname = Column(String(200), nullable=False)
    address = Column(String(45), nullable=True)
    node_type = Column(String(50), default="compute")
    state = Column(String(50), default="unknown")
    cpus = Column(Integer, default=0)
    gpus = Column(Integer, default=0)
    memory_gb = Column(Integer, default=0)
    cpu_usage = Column(Integer, default=0)
    memory_usage = Column(Integer, default=0)
    gpu_usage = Column(Integer, default=0)
    temperature = Column(Integer, nullable=True)
    uptime = Column(Integer, default=0)
    disk_total_gb = Column(Integer, default=0)
    disk_used_gb = Column(Integer, default=0)
    network_in_bytes = Column(Integer, default=0)
    network_out_bytes = Column(Integer, default=0)
    slurm_state = Column(String(50), nullable=True)
    tags = Column(JSONB, nullable=True)
    is_enabled = Column(Boolean, default=True)
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    cluster = relationship("Cluster", back_populates="nodes")

    __table_args__ = (
        UniqueConstraint("hostname", "tenant_id", name="uq_node_hostname_tenant"),
        Index("ix_nodes_tenant", "tenant_id"),
        Index("ix_nodes_cluster", "cluster_id"),
    )


# ---------------------------------------------------------------------------
# System Config
# ---------------------------------------------------------------------------

class SystemConfig(Base):
    __tablename__ = "system_config"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    key = Column(String(100), nullable=False)
    value = Column(JSONB, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("key", "tenant_id", name="uq_config_key_tenant"),
    )


# ---------------------------------------------------------------------------
# Audit Logs
# ---------------------------------------------------------------------------

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String(100), nullable=True)
    details = Column(JSONB, nullable=True)
    ip_address = Column(String(45), nullable=True)
    result = Column(String(20), default="success")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_audit_logs_tenant", "tenant_id"),
        Index("ix_audit_logs_created", "created_at"),
    )


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(String(50), default="info")
    is_read = Column(Boolean, default=False)
    channel = Column(String(50), default="in_app")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_notifications_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    subject = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String(50), default="open")
    priority = Column(String(20), default="medium")
    category = Column(String(50), default="general")
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_to = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tickets_tenant", "tenant_id"),
    )


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Packages
# ---------------------------------------------------------------------------

class Package(Base):
    __tablename__ = "packages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    version = Column(String(50), nullable=False)
    category = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    install_method = Column(String(50), nullable=False)
    status = Column(String(50), default="available")
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_packages_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# HPC Jobs
# ---------------------------------------------------------------------------

class HpcJob(Base):
    __tablename__ = "hpc_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="SET NULL"), nullable=True)
    slurm_job_id = Column(Integer, nullable=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    state = Column(String(50), default="pending")
    partition = Column(String(100), nullable=True)
    nodes = Column(Integer, default=1)
    tasks = Column(Integer, default=1)
    gpus = Column(Integer, default=0)
    walltime = Column(String(20), nullable=True)
    memory = Column(String(20), nullable=True)
    script = Column(Text, nullable=True)
    output_path = Column(String(500), nullable=True)
    error_path = Column(String(500), nullable=True)
    exit_code = Column(Integer, nullable=True)
    cpu_hours = Column(Integer, default=0)
    gpu_hours = Column(Integer, default=0)
    submitted_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_hpc_jobs_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

class StorageMount(Base):
    __tablename__ = "storage_mounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(100), nullable=False)
    mount_point = Column(String(500), nullable=False)
    fs_type = Column(String(50), nullable=False)
    total_gb = Column(Integer, default=0)
    used_gb = Column(Integer, default=0)
    status = Column(String(50), default="active")
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_storage_mounts_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# HPC Software Licenses (existing — distinct from ProductLicense)
# ---------------------------------------------------------------------------

class License(Base):
    __tablename__ = "licenses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    vendor = Column(String(200), nullable=True)
    total_licenses = Column(Integer, default=0)
    used_licenses = Column(Integer, default=0)
    server = Column(String(500), nullable=True)
    status = Column(String(50), default="active")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_licenses_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    category = Column(String(100), nullable=False)
    level = Column(String(20), default="info")
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    source = Column(String(200), nullable=True)
    is_acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    is_resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_alerts_tenant", "tenant_id"),
        Index("ix_alerts_level", "level"),
    )


# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------

class Service(Base):
    __tablename__ = "services"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    display_name = Column(String(200), nullable=True)
    status = Column(String(50), default="unknown")
    version = Column(String(50), nullable=True)
    node_hostname = Column(String(200), nullable=True)
    last_check = Column(DateTime, nullable=True)
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_services_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Network Interfaces
# ---------------------------------------------------------------------------

class NetworkInterface(Base):
    __tablename__ = "network_interfaces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(100), nullable=False)
    ip_address = Column(String(45), nullable=True)
    mac_address = Column(String(17), nullable=True)
    speed_mbps = Column(Integer, default=0)
    is_up = Column(Boolean, default=True)
    rx_bytes = Column(Integer, default=0)
    tx_bytes = Column(Integer, default=0)
    rx_errors = Column(Integer, default=0)
    tx_errors = Column(Integer, default=0)
    rx_drops = Column(Integer, default=0)
    tx_drops = Column(Integer, default=0)
    last_seen = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_network_interfaces_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Backups
# ---------------------------------------------------------------------------

class Backup(Base):
    __tablename__ = "backups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    backup_type = Column(String(50), default="manual")
    status = Column(String(50), default="pending")
    file_path = Column(String(1000), nullable=True)
    file_size_bytes = Column(Integer, default=0)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_backups_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Partitions (Slurm)
# ---------------------------------------------------------------------------

class Partition(Base):
    __tablename__ = "partitions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    max_nodes = Column(Integer, default=0)
    max_time = Column(String(20), nullable=True)
    default_time = Column(String(20), nullable=True)
    is_default = Column(Boolean, default=False)
    status = Column(String(50), default="active")
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("name", "tenant_id", name="uq_partition_name_tenant"),
        Index("ix_partitions_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Storage & NFS Management
# ---------------------------------------------------------------------------

class NfsExport(Base):
    __tablename__ = "nfs_exports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    server_ip = Column(String(50), nullable=True)
    path = Column(String(500), nullable=False)
    allowed_clients = Column(String(500), default="*")
    options = Column(String(500), default="rw,sync,no_root_squash,no_subtree_check")
    is_active = Column(Boolean, default=True)
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_nfs_exports_tenant", "tenant_id"),
    )


class NfsClientMount(Base):
    __tablename__ = "nfs_client_mounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    node_hostname = Column(String(200), nullable=True)
    node_ip = Column(String(50), nullable=False)
    server_ip = Column(String(50), nullable=False)
    export_path = Column(String(500), nullable=False)
    mount_point = Column(String(500), nullable=False)
    mount_options = Column(String(500), default="vers=3,soft,timeo=30,_netdev")
    fstab_persisted = Column(Boolean, default=True)
    status = Column(String(50), default="active")
    last_validated = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_nfs_client_mounts_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Backup Repositories, Jobs & Recovery Points
# ---------------------------------------------------------------------------

class BackupRepository(Base):
    __tablename__ = "backup_repositories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    repo_type = Column(String(50), default="local")
    server_ip = Column(String(50), nullable=True)
    path = Column(String(500), nullable=False)
    protocol = Column(String(50), default="local")
    total_bytes = Column(Integer, default=0)
    used_bytes = Column(Integer, default=0)
    encryption_enabled = Column(Boolean, default=False)
    status = Column(String(50), default="healthy")
    config = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_backup_repositories_tenant", "tenant_id"),
    )


class BackupJob(Base):
    __tablename__ = "backup_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(200), nullable=False)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True)
    source_node_ip = Column(String(50), nullable=True)
    source_directories = Column(JSONB, nullable=True)
    include_patterns = Column(JSONB, nullable=True)
    exclude_patterns = Column(JSONB, nullable=True)
    repo_id = Column(UUID(as_uuid=True), ForeignKey("backup_repositories.id", ondelete="SET NULL"), nullable=True)
    backup_type = Column(String(50), default="full")
    schedule_cron = Column(String(100), default="0 2 * * *")
    is_active = Column(Boolean, default=True)
    retention_full_count = Column(Integer, default=7)
    retention_inc_count = Column(Integer, default=14)
    retention_days = Column(Integer, default=30)
    bandwidth_limit_mb = Column(Integer, default=100)
    status = Column(String(50), default="idle")
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_backup_jobs_tenant", "tenant_id"),
    )


class BackupRecoveryPoint(Base):
    __tablename__ = "backup_recovery_points"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    job_id = Column(UUID(as_uuid=True), ForeignKey("backup_jobs.id", ondelete="CASCADE"), nullable=True)
    chain_id = Column(String(100), nullable=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("backup_recovery_points.id", ondelete="SET NULL"), nullable=True)
    backup_type = Column(String(50), default="full")
    snapshot_id = Column(String(100), nullable=False)
    repo_path = Column(String(500), nullable=False)
    file_count = Column(Integer, default=0)
    total_bytes = Column(Integer, default=0)
    transferred_bytes = Column(Integer, default=0)
    compression_ratio = Column(String(50), default="1.0x")
    manifest_json = Column(JSONB, nullable=True)
    status = Column(String(50), default="completed")
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    logs = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_backup_recovery_points_tenant", "tenant_id"),
        Index("ix_backup_recovery_points_job", "job_id"),
    )


class FileShare(Base):
    __tablename__ = "file_shares"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    node_ip = Column(String(50), nullable=True)
    file_path = Column(String(1000), nullable=False)
    is_dir = Column(Boolean, default=False)
    shared_with_type = Column(String(50), default="user")
    shared_with_name = Column(String(200), nullable=False)
    permission = Column(String(50), default="read")
    created_by_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_file_shares_tenant", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Power Sources Management Models
# ---------------------------------------------------------------------------

class PowerPsu(Base):
    __tablename__ = "power_psus"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    node_hostname = Column(String(100), nullable=False)
    node_ip = Column(String(50), nullable=False)
    psu_index = Column(Integer, default=1)
    manufacturer = Column(String(100), default="Dell / Emerson")
    model = Column(String(100), default="750W Titanium Hot-Plug")
    serial_number = Column(String(100), nullable=True)
    wattage = Column(Integer, default=750)
    current_watts = Column(Integer, default=142)
    voltage_in = Column(Integer, default=230)
    voltage_out = Column(Integer, default=12)
    efficiency = Column(String(50), default="80 PLUS Platinum (94%)")
    temperature = Column(Integer, default=36)
    redundancy_status = Column(String(50), default="Redundant (1+1)")
    health_status = Column(String(50), default="OK")
    is_enabled = Column(Boolean, default=True)
    last_updated = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_power_psus_tenant", "tenant_id"),
        Index("ix_power_psus_node", "node_hostname"),
    )


class PowerUps(Base):
    __tablename__ = "power_ups"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(150), nullable=False)
    manufacturer = Column(String(100), default="APC / Schneider Electric")
    model = Column(String(100), default="Smart-UPS SRT 3000VA RM")
    serial_number = Column(String(100), default="AS1934001928")
    ip_address = Column(String(50), nullable=False)
    snmp_version = Column(String(20), default="v3")
    snmp_port = Column(Integer, default=161)
    community_v2 = Column(String(100), default="public")
    snmpv3_user = Column(String(100), default="hpcadmin")
    snmpv3_auth_proto = Column(String(20), default="SHA256")
    snmpv3_auth_secret = Column(String(200), nullable=True)
    snmpv3_priv_proto = Column(String(20), default="AES")
    snmpv3_priv_secret = Column(String(200), nullable=True)
    input_voltage = Column(Integer, default=231)
    input_frequency = Column(Integer, default=50)
    output_voltage = Column(Integer, default=230)
    load_percentage = Column(Integer, default=34)
    load_watts = Column(Integer, default=890)
    battery_charge_pct = Column(Integer, default=100)
    battery_runtime_min = Column(Integer, default=48)
    battery_health = Column(String(50), default="Normal")
    battery_temp = Column(Integer, default=25)
    operating_mode = Column(String(50), default="Online (Normal)")
    status = Column(String(50), default="online")
    associated_nodes = Column(JSONB, default=lambda: ["mas", "node"])
    last_poll = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_power_ups_tenant", "tenant_id"),
    )


class PowerBmc(Base):
    __tablename__ = "power_bmcs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    node_hostname = Column(String(100), nullable=False)
    node_ip = Column(String(50), nullable=False)
    bmc_type = Column(String(50), default="Dell iDRAC 9")
    bmc_ip = Column(String(50), nullable=False)
    bmc_port = Column(Integer, default=623)
    username = Column(String(100), default="root")
    password_enc = Column(String(255), nullable=True)
    auth_method = Column(String(50), default="password")
    connection_status = Column(String(50), default="connected")
    firmware_version = Column(String(100), default="v6.10.30.00")
    power_state = Column(String(50), default="on")
    system_watts = Column(Integer, default=284)
    inlet_temp_c = Column(Integer, default=22)
    last_tested = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_power_bmcs_tenant", "tenant_id"),
        Index("ix_power_bmcs_node", "node_hostname"),
    )


class PowerAlertRule(Base):
    __tablename__ = "power_alert_rules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(150), nullable=False)
    metric = Column(String(100), nullable=False)
    condition = Column(String(20), default="<=")
    warning_threshold = Column(Integer, default=30)
    critical_threshold = Column(Integer, default=15)
    cooldown_seconds = Column(Integer, default=300)
    notify_channels = Column(JSONB, default=lambda: ["in_app", "email"])
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_power_alert_rules_tenant", "tenant_id"),
    )


class PowerShutdownPolicy(Base):
    __tablename__ = "power_shutdown_policies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    name = Column(String(150), nullable=False)
    target_ups_id = Column(UUID(as_uuid=True), nullable=True)
    target_ups_name = Column(String(150), default="APC Smart-UPS SRT 3000VA RM")
    associated_nodes = Column(JSONB, default=lambda: ["node", "mas"])
    trigger_runtime_min = Column(Integer, default=10)
    trigger_battery_pct = Column(Integer, default=20)
    require_consecutive_checks = Column(Integer, default=3)
    grace_period_sec = Column(Integer, default=120)
    shutdown_order = Column(JSONB, default=lambda: [
        {"stage": 1, "target": "slurm_jobs", "action": "drain_and_cancel_workloads", "timeout_sec": 45},
        {"stage": 2, "target": "compute_nodes", "action": "graceful_shutdown", "nodes": ["node"], "timeout_sec": 60},
        {"stage": 3, "target": "storage_services", "action": "unmount_nfs_and_sync", "nodes": ["mas"], "timeout_sec": 40},
        {"stage": 4, "target": "controller_node", "action": "shutdown_last", "nodes": ["mas"], "timeout_sec": 60}
    ])
    shutdown_timeout_sec = Column(Integer, default=180)
    dry_run_mode = Column(Boolean, default=True)
    admin_approved = Column(Boolean, default=False)
    enabled = Column(Boolean, default=False)
    last_run = Column(DateTime, nullable=True)
    last_result = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_power_shutdown_policies_tenant", "tenant_id"),
    )


class PowerEvent(Base):
    __tablename__ = "power_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    device_name = Column(String(150), nullable=False)
    device_type = Column(String(50), default="UPS")
    event_type = Column(String(100), nullable=False)
    severity = Column(String(20), default="info")
    trigger_condition = Column(String(255), nullable=True)
    previous_state = Column(String(100), nullable=True)
    current_state = Column(String(100), nullable=True)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_power_events_tenant", "tenant_id"),
        Index("ix_power_events_created", "created_at"),
    )


# ---------------------------------------------------------------------------
# BMC / iDRAC / iLO & Hardware Inventory Models
# ---------------------------------------------------------------------------

class BmcServer(Base):
    __tablename__ = "bmc_servers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    server_name = Column(String(150), nullable=False)
    hostname = Column(String(100), nullable=False)
    node_ip = Column(String(50), nullable=False)
    controller_type = Column(String(50), default="Dell iDRAC")  # Generic BMC, Dell iDRAC, HPE iLO
    bmc_ip = Column(String(50), nullable=False)
    port = Column(Integer, default=443)
    username = Column(String(100), default="root")
    password_enc = Column(String(255), nullable=True)
    protocol = Column(String(50), default="Redfish")  # Redfish, IPMI, Vendor REST
    tls_verify = Column(Boolean, default=True)
    auth_status = Column(String(50), default="Authenticated")
    connection_status = Column(String(50), default="Connected")
    firmware_version = Column(String(100), default="v6.10.30.00")
    capabilities = Column(JSONB, default=lambda: [
        "inventory_read", "power_state_read", "power_on",
        "graceful_shutdown", "power_cycle", "psu_monitoring",
        "thermal_monitoring", "event_log_read"
    ])
    last_tested = Column(DateTime, default=datetime.utcnow)
    last_inventory_sync = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_bmc_servers_tenant", "tenant_id"),
        Index("ix_bmc_servers_hostname", "hostname"),
    )


class HardwareInventory(Base):
    __tablename__ = "hardware_inventories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bmc_server_id = Column(UUID(as_uuid=True), ForeignKey("bmc_servers.id", ondelete="CASCADE"), nullable=True)
    hostname = Column(String(100), nullable=False)
    system_info = Column(JSONB, nullable=True)
    processor_info = Column(JSONB, nullable=True)
    memory_info = Column(JSONB, nullable=True)
    storage_info = Column(JSONB, nullable=True)
    power_thermal_info = Column(JSONB, nullable=True)
    network_info = Column(JSONB, nullable=True)
    raw_telemetry = Column(JSONB, nullable=True)
    collected_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_hardware_inventories_server", "bmc_server_id"),
        Index("ix_hardware_inventories_host", "hostname"),
    )


class BmcConnectionHistory(Base):
    __tablename__ = "bmc_connection_histories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    bmc_server_id = Column(UUID(as_uuid=True), nullable=True)
    server_name = Column(String(150), nullable=False)
    hostname = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False)
    status = Column(String(50), default="Success")
    protocol_used = Column(String(50), default="Redfish")
    latency_ms = Column(Integer, default=18)
    details = Column(JSONB, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_bmc_history_created", "created_at"),
    )


# ---------------------------------------------------------------------------
# Desired State & Offline-Safe Reconciliation Models
# ---------------------------------------------------------------------------

class OperationStatus(str, enum.Enum):
    PENDING = "pending"
    APPLYING = "applying"
    APPLIED = "applied"
    FAILED = "failed"
    SKIPPED_OFFLINE = "skipped_offline"
    PARTIAL = "partial"


class Operation(Base):
    __tablename__ = "operations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(String(100), nullable=False)
    payload_json = Column(Text, nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    idempotency_key = Column(String(128), nullable=True, index=True)
    status = Column(String(50), default="pending", nullable=False)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)

    targets = relationship("OperationTarget", back_populates="operation", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        Index("ix_operations_status", "status"),
        Index("ix_operations_created_at", "created_at"),
        Index("ix_operations_idempotency", "idempotency_key"),
    )


class OperationTarget(Base):
    __tablename__ = "operation_targets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_id = Column(UUID(as_uuid=True), ForeignKey("operations.id", ondelete="CASCADE"), nullable=False)
    target_host = Column(String(255), nullable=False)
    target_role = Column(String(50), default="node", nullable=False)
    status = Column(String(50), default="pending", nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)
    last_attempt_at = Column(DateTime, nullable=True)
    applied_at = Column(DateTime, nullable=True)
    next_retry_at = Column(DateTime, nullable=True)
    execution_log = Column(Text, nullable=True)

    operation = relationship("Operation", back_populates="targets")

    __table_args__ = (
        Index("ix_op_targets_op_id", "operation_id"),
        Index("ix_op_targets_host_status", "target_host", "status"),
        Index("ix_op_targets_retry", "status", "next_retry_at"),
    )


class TargetHealth(Base):
    __tablename__ = "target_health"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    host = Column(String(255), unique=True, nullable=False, index=True)
    role = Column(String(50), default="node", nullable=False)
    online = Column(Boolean, default=False, nullable=False)
    last_seen = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_target_health_online", "online"),
    )


# ---------------------------------------------------------------------------
# Fresh Configuration, Decommissioning, Rollback & Package Management Models
# ---------------------------------------------------------------------------

class CleanupOperation(Base):
    __tablename__ = "cleanup_operations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_type = Column(String(50), nullable=False) # remove_demo, remove_duplicates, remove_tests, reset_module, fresh_deployment, full_reset
    target_module = Column(String(50), default="all", nullable=False)
    status = Column(String(50), default="pending", nullable=False) # pending, previewed, in_progress, completed, failed, rolled_back
    total_records_affected = Column(Integer, default=0, nullable=False)
    backup_path = Column(String(500), nullable=True)
    preview_data = Column(Text, nullable=True)
    execution_summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    initiated_by = Column(String(100), default="admin", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    items = relationship("CleanupOperationItem", back_populates="cleanup_operation", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        Index("ix_cleanup_op_status", "status"),
        Index("ix_cleanup_op_type", "operation_type"),
    )


class CleanupOperationItem(Base):
    __tablename__ = "cleanup_operation_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cleanup_op_id = Column(UUID(as_uuid=True), ForeignKey("cleanup_operations.id", ondelete="CASCADE"), nullable=False)
    table_name = Column(String(100), nullable=False)
    record_id = Column(String(100), nullable=False)
    category = Column(String(50), nullable=False) # demo, test, duplicate, orphaned, system, customer
    action_taken = Column(String(50), default="deleted", nullable=False) # deleted, skipped, archived
    backup_payload = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    cleanup_operation = relationship("CleanupOperation", back_populates="items")

    __table_args__ = (
        Index("ix_cleanup_item_op_id", "cleanup_op_id"),
        Index("ix_cleanup_item_category", "category"),
    )


class ClusterDecommissionJob(Base):
    __tablename__ = "cluster_decommission_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False)
    cluster_name = Column(String(255), nullable=False)
    status = Column(String(50), default="draft", nullable=False) # draft, discovered, backup_ready, in_progress, completed, partially_completed, failed, aborted
    selected_options = Column(Text, nullable=False) # JSON array of options 1-10
    selected_nodes = Column(Text, nullable=False) # JSON array of node IDs/IPs
    dependency_map = Column(Text, nullable=True) # JSON discovery map of services, mounts, configs
    rollback_manifest_id = Column(UUID(as_uuid=True), nullable=True)
    execution_logs = Column(Text, nullable=True)
    verification_report = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    initiated_by = Column(String(100), default="admin", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    node_jobs = relationship("NodeDecommissionJob", back_populates="cluster_job", cascade="all, delete-orphan", lazy="selectin")

    __table_args__ = (
        Index("ix_decommission_cluster_id", "cluster_id"),
        Index("ix_decommission_status", "status"),
    )


class NodeDecommissionJob(Base):
    __tablename__ = "node_decommission_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_decommission_id = Column(UUID(as_uuid=True), ForeignKey("cluster_decommission_jobs.id", ondelete="CASCADE"), nullable=False)
    node_id = Column(UUID(as_uuid=True), nullable=True)
    node_hostname = Column(String(255), nullable=False)
    node_ip = Column(String(64), nullable=False)
    node_role = Column(String(50), default="compute", nullable=False) # master, compute
    status = Column(String(50), default="pending", nullable=False) # pending, draining, in_progress, completed, partially_decommissioned, unreachable, failed
    execution_logs = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cluster_job = relationship("ClusterDecommissionJob", back_populates="node_jobs")

    __table_args__ = (
        Index("ix_node_decom_job_id", "cluster_decommission_id"),
        Index("ix_node_decom_host", "node_hostname"),
    )


class ConfigurationSnapshot(Base):
    __tablename__ = "configuration_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), nullable=True)
    node_hostname = Column(String(255), nullable=False)
    node_ip = Column(String(64), nullable=False)
    snapshot_type = Column(String(50), default="pre_deployment", nullable=False) # initial_baseline, pre_deployment, pre_decommission, manual_backup, pre_package_change
    components_data = Column(Text, nullable=False) # JSON: hostname, dns, hosts, chrony, ssh, munge, slurm, nfs, sssd, services, iptables, packages
    checksum = Column(String(128), nullable=True)
    file_manifest = Column(Text, nullable=True) # JSON list of backed up file paths & backup locations
    created_by = Column(String(100), default="admin", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_cfg_snapshot_node", "node_hostname"),
        Index("ix_cfg_snapshot_type", "snapshot_type"),
    )


class RollbackManifest(Base):
    __tablename__ = "rollback_manifests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    scope = Column(String(50), default="node", nullable=False) # cluster, node, package, system
    target_id = Column(String(100), nullable=False) # cluster_id or node_id
    snapshot_id = Column(UUID(as_uuid=True), ForeignKey("configuration_snapshots.id", ondelete="SET NULL"), nullable=True)
    components = Column(Text, nullable=False) # JSON list of components covered
    file_backups = Column(Text, nullable=True) # JSON map of original_path -> backup_path
    package_manifest = Column(Text, nullable=True) # JSON list of packages to restore/remove
    services_state = Column(Text, nullable=True) # JSON list of service states to restore
    created_at = Column(DateTime, default=datetime.utcnow)


class RollbackOperation(Base):
    __tablename__ = "rollback_operations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    manifest_id = Column(UUID(as_uuid=True), ForeignKey("rollback_manifests.id", ondelete="SET NULL"), nullable=True)
    node_id = Column(UUID(as_uuid=True), nullable=True)
    node_hostname = Column(String(255), nullable=False)
    rollback_mode = Column(String(50), default="hpc_services", nullable=False) # agent_only, hpc_services, network_identity, application_packages, complete_ayal_hpc
    status = Column(String(50), default="pending", nullable=False) # pending, in_progress, completed, failed, verified
    diff_summary = Column(Text, nullable=True) # JSON of diff before vs after
    execution_logs = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    initiated_by = Column(String(100), default="admin", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_rollback_op_node", "node_hostname"),
        Index("ix_rollback_op_status", "status"),
    )


class PackageInventory(Base):
    __tablename__ = "package_inventory"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), nullable=True)
    node_hostname = Column(String(255), nullable=False)
    node_ip = Column(String(64), nullable=False)
    package_name = Column(String(255), nullable=False)
    version = Column(String(100), nullable=False)
    release = Column(String(100), nullable=True)
    architecture = Column(String(50), default="x86_64", nullable=False)
    package_manager = Column(String(50), default="rpm", nullable=False) # rpm, dnf, yum, dpkg, apt, spack, lmod
    category = Column(String(50), default="tools", nullable=False) # hpc, system, runtime, compiler, library, driver, tools
    install_date = Column(DateTime, nullable=True)
    size_bytes = Column(Integer, nullable=True)
    vendor = Column(String(255), nullable=True)
    summary = Column(Text, nullable=True)
    is_critical_system = Column(Boolean, default=False, nullable=False) # SSH, bash, kernel, glibc, systemd, yum/dnf
    last_scanned_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_pkg_inv_node_pkg", "node_hostname", "package_name"),
        Index("ix_pkg_inv_category", "category"),
        UniqueConstraint("node_hostname", "package_name", "package_manager", name="uq_node_package_manager"),
    )


class PackageOperation(Base):
    __tablename__ = "package_operations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_type = Column(String(50), nullable=False) # install, uninstall, update, rollback
    cluster_id = Column(UUID(as_uuid=True), nullable=True)
    node_id = Column(UUID(as_uuid=True), nullable=True)
    node_hostname = Column(String(255), nullable=False)
    package_name = Column(String(255), nullable=False)
    target_version = Column(String(100), nullable=True)
    previous_version = Column(String(100), nullable=True)
    package_manager = Column(String(50), default="rpm", nullable=False)
    status = Column(String(50), default="pending", nullable=False) # pending, waiting_approval, running, completed, failed, partially_completed, rolled_back, cancelled
    dependency_impact = Column(Text, nullable=True)
    execution_logs = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    initiated_by = Column(String(100), default="admin", nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_pkg_op_status", "status"),
        Index("ix_pkg_op_node", "node_hostname"),
    )


class PackageDependency(Base):
    __tablename__ = "package_dependencies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    package_name = Column(String(255), nullable=False)
    depends_on_package = Column(String(255), nullable=False)
    min_version = Column(String(100), nullable=True)
    is_shared = Column(Boolean, default=False, nullable=False)
    dependent_clusters = Column(Text, nullable=True) # JSON array of cluster names using this

    __table_args__ = (
        Index("ix_pkg_dep_pkg", "package_name"),
        Index("ix_pkg_dep_on", "depends_on_package"),
    )


class OperationApproval(Base):
    __tablename__ = "operation_approvals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_type = Column(String(100), nullable=False) # cluster_decommission, full_reset, force_uninstall_package, server_rollback
    target_name = Column(String(255), nullable=False)
    confirmation_phrase_required = Column(String(255), nullable=False)
    confirmation_phrase_entered = Column(String(255), nullable=False)
    approved_by = Column(String(100), default="admin", nullable=False)
    approved_at = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_op_approval_type", "operation_type"),
    )


# ---------------------------------------------------------------------------
# Centralized Live HPC Monitoring & Telemetry Models
# ---------------------------------------------------------------------------

class NodeMetric(Base):
    """Timestamped historical system metrics collected from each HPC node."""
    __tablename__ = "node_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    cpu_utilization = Column(Float, default=0.0)
    cpu_temp_c = Column(Float, nullable=True)
    load_1m = Column(Float, default=0.0)
    load_5m = Column(Float, default=0.0)
    load_15m = Column(Float, default=0.0)
    
    memory_total_mb = Column(Float, default=0.0)
    memory_used_mb = Column(Float, default=0.0)
    memory_available_mb = Column(Float, default=0.0)
    memory_utilization = Column(Float, default=0.0)
    
    uptime_seconds = Column(Integer, default=0)
    process_count = Column(Integer, default=0)
    is_live = Column(Boolean, default=True)

    __table_args__ = (
        Index("ix_node_metrics_node_time", "node_id", "timestamp"),
        Index("ix_node_metrics_cluster_time", "cluster_id", "timestamp"),
    )


class NodeNetworkMetric(Base):
    """Network interface metrics, bandwidth and packet counters."""
    __tablename__ = "node_network_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    interface_name = Column(String(64), nullable=False)
    ip_address = Column(String(64), nullable=True)
    mac_address = Column(String(64), nullable=True)
    link_status = Column(String(32), default="up") # up, down
    speed_mbps = Column(Integer, nullable=True)
    
    rx_bytes_sec = Column(Float, default=0.0)
    tx_bytes_sec = Column(Float, default=0.0)
    rx_errors = Column(Integer, default=0)
    tx_errors = Column(Integer, default=0)
    rx_drops = Column(Integer, default=0)
    tx_drops = Column(Integer, default=0)

    __table_args__ = (
        Index("ix_node_net_metrics_node_time", "node_id", "timestamp"),
        Index("ix_node_net_metrics_iface", "node_id", "interface_name"),
    )


class NodeStorageMetric(Base):
    """Storage, filesystem mount points and disk I/O metrics."""
    __tablename__ = "node_storage_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    mount_point = Column(String(255), nullable=False)
    filesystem = Column(String(255), nullable=True)
    fs_type = Column(String(64), nullable=True)
    
    total_bytes = Column(BigInteger, default=0)
    used_bytes = Column(BigInteger, default=0)
    free_bytes = Column(BigInteger, default=0)
    utilization_pct = Column(Float, default=0.0)
    
    read_bytes_sec = Column(Float, default=0.0)
    write_bytes_sec = Column(Float, default=0.0)
    nfs_status = Column(String(32), nullable=True) # mounted, error, n/a

    __table_args__ = (
        Index("ix_node_storage_metrics_node_time", "node_id", "timestamp"),
        Index("ix_node_storage_mount", "node_id", "mount_point"),
    )


class NodeGpuMetric(Base):
    """GPU acceleration metrics and thermal status."""
    __tablename__ = "node_gpu_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    gpu_index = Column(Integer, default=0)
    gpu_name = Column(String(128), nullable=False)
    driver_version = Column(String(64), nullable=True)
    
    utilization_pct = Column(Float, default=0.0)
    memory_total_mb = Column(Float, default=0.0)
    memory_used_mb = Column(Float, default=0.0)
    memory_free_mb = Column(Float, default=0.0)
    temperature_c = Column(Float, nullable=True)
    power_watts = Column(Float, nullable=True)

    __table_args__ = (
        Index("ix_node_gpu_metrics_node_time", "node_id", "timestamp"),
    )


class NodeServiceStatus(Base):
    """Status of core HPC services running on each node."""
    __tablename__ = "node_services"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    
    service_name = Column(String(64), nullable=False) # slurmd, slurmctld, munge, sssd, chronyd, nfs-server, etc.
    display_name = Column(String(128), nullable=False)
    status = Column(String(32), default="unknown") # running, stopped, failed, unconfigured
    enabled = Column(String(32), default="unknown") # enabled, disabled, static
    version = Column(String(64), nullable=True)
    last_checked = Column(DateTime, default=datetime.utcnow)
    error_message = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("node_id", "service_name", name="uq_node_service"),
        Index("ix_node_services_node", "node_id"),
        Index("ix_node_services_status", "status"),
    )


class NodeApplication(Base):
    """Centralized installed software, packages, and modules on each node."""
    __tablename__ = "node_applications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    
    name = Column(String(255), nullable=False)
    version = Column(String(128), nullable=False)
    source = Column(String(64), default="rpm") # rpm, spack, lmod, source, binary
    path = Column(String(512), nullable=True)
    package_manager = Column(String(64), default="dnf") # dnf, yum, rpm, spack, module
    status = Column(String(32), default="installed") # installed, broken, updating
    dependencies = Column(Text, nullable=True) # JSON array
    last_synced = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("node_id", "name", "version", "source", name="uq_node_app_ver_src"),
        Index("ix_node_apps_node", "node_id"),
        Index("ix_node_apps_name", "name"),
    )


class SlurmClusterMetric(Base):
    """Centralized snapshot of Slurm controller, partitions, nodes, and jobs."""
    __tablename__ = "slurm_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    controller_status = Column(String(32), default="unknown") # running, offline, degraded
    controller_version = Column(String(64), nullable=True)
    
    total_nodes = Column(Integer, default=0)
    active_nodes = Column(Integer, default=0)
    drain_nodes = Column(Integer, default=0)
    down_nodes = Column(Integer, default=0)
    
    total_cpus = Column(Integer, default=0)
    allocated_cpus = Column(Integer, default=0)
    
    running_jobs = Column(Integer, default=0)
    pending_jobs = Column(Integer, default=0)
    failed_jobs = Column(Integer, default=0)
    
    partitions_data = Column(JSONB, nullable=True)
    node_states_data = Column(JSONB, nullable=True)
    job_queue_data = Column(JSONB, nullable=True)

    __table_args__ = (
        Index("ix_slurm_metrics_cluster_time", "cluster_id", "timestamp"),
    )


class AgentStatus(Base):
    """Health, version, and heartbeat tracking for the AYAL Monitoring Agent on each node."""
    __tablename__ = "agent_status"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), unique=True, nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    
    agent_version = Column(String(32), default="1.0.0")
    status = Column(String(32), default="unknown") # online, offline, degraded
    listen_port = Column(Integer, default=9100)
    auth_token = Column(String(255), nullable=True)
    
    last_heartbeat = Column(DateTime, default=datetime.utcnow)
    uptime_seconds = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    last_error = Column(Text, nullable=True)
    collection_interval = Column(Integer, default=5) # seconds

    __table_args__ = (
        Index("ix_agent_status_node", "node_id"),
        Index("ix_agent_status_heartbeat", "last_heartbeat"),
    )


class MonitoringAlert(Base):
    """Real-time threshold alerts triggered by live metrics."""
    __tablename__ = "monitoring_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id", ondelete="CASCADE"), nullable=True)
    
    alert_type = Column(String(64), nullable=False) # node_down, high_cpu, high_memory, high_storage, service_failed, slurm_drain
    severity = Column(String(32), default="warning") # critical, warning, info
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    threshold = Column(String(64), nullable=True)
    current_value = Column(String(64), nullable=True)
    
    is_resolved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_monitoring_alerts_cluster", "cluster_id"),
        Index("ix_monitoring_alerts_node", "node_id"),
        Index("ix_monitoring_alerts_unresolved", "is_resolved", "severity"),
    )


