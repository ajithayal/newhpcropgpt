from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from uuid import UUID
from typing import Optional, Dict, Any, List, Union
from app.core.validators import validate_ipv4_address


# ---------------------------------------------------------------------------
# User schemas
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    email: str
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None
    role: str = "researcher"
    group_id: Optional[UUID] = None
    tenant_id: Optional[UUID] = None
    quota_storage_gb: int = 100
    quota_core_hours: int = 1000
    quota_max_jobs: int = 100


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    group_id: Optional[UUID] = None
    quota_storage_gb: Optional[int] = None
    quota_core_hours: Optional[int] = None
    quota_max_jobs: Optional[int] = None
    ssh_public_key: Optional[str] = None
    password: Optional[str] = None
    freeipa_uid: Optional[str] = None
    freeipa_gid: Optional[int] = None


class UserResponse(BaseModel):
    id: UUID
    tenant_id: Optional[UUID] = None
    username: str
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    is_local: bool
    is_2fa_enabled: bool
    group_id: Optional[UUID]
    quota_storage_gb: int
    quota_core_hours: int
    quota_max_jobs: int
    freeipa_uid: Optional[str] = None
    freeipa_gid: Optional[int] = None
    last_login: Optional[datetime]
    created_at: datetime
    reconcile_status: Optional[str] = None
    reconcile_message: Optional[str] = None
    operation_id: Optional[str] = None
    target_results: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ---------------------------------------------------------------------------
# Setup schemas
# ---------------------------------------------------------------------------

class SetupStep1Request(BaseModel):
    company_name: str
    short_name: str
    organization_type: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    email: str
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    pin_zip: Optional[str] = None
    timezone: str = "UTC"


class SetupStep2Request(BaseModel):
    contact_name: str
    contact_designation: Optional[str] = None
    contact_email: str
    contact_phone: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None


class SetupStep3Request(BaseModel):
    admin_username: str = Field(..., min_length=3)
    admin_full_name: str
    admin_email: str
    admin_mobile: Optional[str] = None
    admin_password: str = Field(..., min_length=8)
    admin_confirm_password: str


class SetupStep4Request(BaseModel):
    customer_id: str
    customer_email: str
    license_key: str


class SetupRequest(BaseModel):
    step1: SetupStep1Request
    step2: SetupStep2Request
    step3: SetupStep3Request
    step4: SetupStep4Request


class SetupStatus(BaseModel):
    is_configured: bool
    admin_exists: bool
    license_activated: bool = False


# ---------------------------------------------------------------------------
# License schemas
# ---------------------------------------------------------------------------

class LicenseIssueRequest(BaseModel):
    customer_id: str
    customer_email: str
    plan: str = "standard"
    max_nodes: Optional[int] = None
    max_clusters: int = 1
    notes: Optional[str] = None


class LicenseActivateRequest(BaseModel):
    customer_id: str
    customer_email: str
    license_key: str


class LicenseResponse(BaseModel):
    id: UUID
    customer_id: str
    customer_email: str
    status: str
    plan: str
    max_nodes: Optional[int]
    max_clusters: int
    issued_at: datetime
    activated_at: Optional[datetime]
    expires_at: Optional[datetime]
    activated_from_ip: Optional[str]
    tenant_id: Optional[UUID]

    class Config:
        from_attributes = True


class LicenseStatusResponse(BaseModel):
    is_valid: bool
    status: str
    plan: str
    customer_id: str
    activated_at: Optional[datetime]
    expires_at: Optional[datetime]
    max_nodes: Optional[int]
    max_clusters: int


# ---------------------------------------------------------------------------
# Tenant schemas
# ---------------------------------------------------------------------------

class TenantCreate(BaseModel):
    name: str
    short_name: str
    organization_type: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    email: str
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    pin_zip: Optional[str] = None
    timezone: str = "UTC"


class TenantResponse(BaseModel):
    id: UUID
    name: str
    short_name: str
    organization_type: Optional[str]
    industry: Optional[str]
    website: Optional[str]
    email: str
    phone: Optional[str]
    city: Optional[str]
    state: Optional[str]
    country: Optional[str]
    timezone: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Config schemas
# ---------------------------------------------------------------------------

class FreeIPAConfig(BaseModel):
    ldap_url: str
    base_dn: str
    bind_dn: str
    bind_password: str
    ca_cert_path: Optional[str] = None
    kerberos_realm: Optional[str] = None
    sync_interval_minutes: int = 30


class BrandingUpdate(BaseModel):
    brand_name: Optional[str] = None
    logo_path: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None
    support_website: Optional[str] = None
    theme_color: Optional[str] = None


class ClusterConfigUpdate(BaseModel):
    cluster_name: Optional[str] = None
    timezone: Optional[str] = None
    total_nodes: Optional[int] = None


# ---------------------------------------------------------------------------
# Group schemas
# ---------------------------------------------------------------------------

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    freeipa_gid: Optional[int] = None
    quota_storage_gb: int = 1000
    quota_core_hours: int = 10000


class GroupResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    freeipa_gid: Optional[int]
    quota_storage_gb: int
    quota_core_hours: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Ticket schemas
# ---------------------------------------------------------------------------

class TicketCreate(BaseModel):
    subject: str
    description: str
    priority: str = "medium"
    category: str = "general"


class TicketResponse(BaseModel):
    id: UUID
    subject: str
    description: str
    status: str
    priority: str
    category: str
    created_by: Optional[UUID]
    assigned_to: Optional[UUID]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TicketCommentCreate(BaseModel):
    comment: str


# ---------------------------------------------------------------------------
# Job schemas
# ---------------------------------------------------------------------------

class JobSubmit(BaseModel):
    name: str
    partition: Optional[str] = "default"
    nodes: int = 1
    tasks: int = 1
    gpus: int = 0
    walltime: str = "01:00:00"
    memory: str = "4G"
    script: str
    output_path: Optional[str] = None
    error_path: Optional[str] = None


class JobResponse(BaseModel):
    id: UUID
    slurm_job_id: Optional[int]
    user_id: Optional[UUID]
    name: str
    state: str
    partition: Optional[str]
    nodes: int
    tasks: int
    gpus: int
    walltime: Optional[str]
    memory: Optional[str]
    exit_code: Optional[int]
    cpu_hours: int
    gpu_hours: int
    submitted_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Node schemas
# ---------------------------------------------------------------------------

class NodeCreate(BaseModel):
    hostname: str
    address: Optional[str] = None
    node_type: str = "compute"
    cpus: int = 0
    gpus: int = 0
    memory_gb: int = 0
    cluster_id: Optional[UUID] = None
    tags: Optional[dict] = None

    @field_validator("address")
    @classmethod
    def check_address(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return validate_ipv4_address(v, field_name="Node address")
        return v


class NodeUpdate(BaseModel):
    address: Optional[str] = None
    node_type: Optional[str] = None
    cpus: Optional[int] = None
    gpus: Optional[int] = None
    memory_gb: Optional[int] = None
    cluster_id: Optional[UUID] = None
    tags: Optional[dict] = None
    is_enabled: Optional[bool] = None

    @field_validator("address")
    @classmethod
    def check_address(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return validate_ipv4_address(v, field_name="Node address")
        return v


class NodeResponse(BaseModel):
    id: UUID
    tenant_id: Optional[UUID] = None
    cluster_id: Optional[UUID] = None
    hostname: str
    address: Optional[str] = None
    node_type: str = "compute"
    state: str = "online"
    cpus: Optional[int] = 1
    gpus: Optional[int] = 0
    memory_gb: Optional[Union[float, int]] = 1.0
    cpu_usage: Optional[float] = 0.0
    memory_usage: Optional[float] = 0.0
    gpu_usage: Optional[float] = 0.0
    temperature: Optional[float] = None
    uptime: Optional[Union[int, str, float]] = 0
    disk_total_gb: Optional[Union[float, int]] = 0
    disk_used_gb: Optional[Union[float, int]] = 0
    slurm_state: Optional[str] = None
    is_enabled: bool = True
    last_seen: Optional[datetime] = None
    tags: Optional[dict] = None

    @field_validator("tags")
    @classmethod
    def sanitize_tags(cls, v: Optional[dict]) -> Optional[dict]:
        if not v or not isinstance(v, dict):
            return v
        return {k: val for k, val in v.items() if not k.startswith("_") and k not in ("ssh_password", "password", "ssh_key")}

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Storage schemas
# ---------------------------------------------------------------------------

class StorageMountCreate(BaseModel):
    name: str
    mount_point: str
    fs_type: str
    total_gb: int = 0
    config: Optional[dict] = None


class StorageMountResponse(BaseModel):
    id: UUID
    name: str
    mount_point: str
    fs_type: str
    total_gb: int
    used_gb: int
    status: str
    config: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Package schemas
# ---------------------------------------------------------------------------

class PackageResponse(BaseModel):
    id: UUID
    name: str
    version: str
    category: str
    description: Optional[str]
    install_method: str
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Notification schemas
# ---------------------------------------------------------------------------

class NotificationResponse(BaseModel):
    id: UUID
    title: str
    message: str
    type: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Audit schemas
# ---------------------------------------------------------------------------

class AuditLogResponse(BaseModel):
    id: UUID
    user_id: Optional[UUID]
    action: str
    resource_type: Optional[str]
    resource_id: Optional[str]
    details: Optional[dict]
    ip_address: Optional[str]
    result: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Alert schemas
# ---------------------------------------------------------------------------

class AlertResponse(BaseModel):
    id: UUID
    category: str
    level: str
    title: str
    message: Optional[str]
    source: Optional[str]
    is_acknowledged: bool
    acknowledged_by: Optional[UUID]
    acknowledged_at: Optional[datetime]
    is_resolved: bool
    resolved_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Service schemas
# ---------------------------------------------------------------------------

class ServiceResponse(BaseModel):
    id: UUID
    name: str
    display_name: Optional[str]
    status: str
    version: Optional[str]
    node_hostname: Optional[str]
    last_check: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Partition schemas
# ---------------------------------------------------------------------------

class PartitionCreate(BaseModel):
    name: str
    max_nodes: int = 0
    max_time: Optional[str] = None
    default_time: Optional[str] = None
    is_default: bool = False
    cluster_id: Optional[UUID] = None


class PartitionResponse(BaseModel):
    id: UUID
    name: str
    max_nodes: int
    max_time: Optional[str]
    default_time: Optional[str]
    is_default: bool
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Cluster schemas
# ---------------------------------------------------------------------------

class ClusterCreate(BaseModel):
    name: str
    description: Optional[str] = None
    scheduler_type: str = "slurm"


class ClusterResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    scheduler_type: str
    total_nodes: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Setup, Customer Registration & M365 SMTP Schemas
# ---------------------------------------------------------------------------

class SmtpTestRequest(BaseModel):
    app_password: str
    test_recipient: str
    sender_username: Optional[str] = None


class CustomerRegisterRequest(BaseModel):
    organization_name: str
    admin_name: str
    business_email: str
    phone: str
    country: str
    city: str
    cluster_name: Optional[str] = "Main Cluster"
    address: Optional[str] = ""
    admin_username: Optional[str] = "admin"
    admin_password: Optional[str] = None


class EmailConfirmRequest(BaseModel):
    customer_id: str
    code: str


class ResendOtpRequest(BaseModel):
    customer_id: str


class LicenseActivateWizardRequest(BaseModel):
    customer_id: str
    license_key: str


class InstallTaskRequest(BaseModel):
    customer_id: str
    task_id: str


class FinalizeAdminRequest(BaseModel):
    customer_id: str
    admin_username: str = "admin"
    admin_password: str
    admin_full_name: str = "System Administrator"


class FinalizeSystemRequest(BaseModel):
    customer_id: str
    admin_username: Optional[str] = "admin"
    admin_password: Optional[str] = None
    admin_full_name: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: str
    captcha_token: Optional[str] = None


class ForgotPasswordVerifyOtpRequest(BaseModel):
    email: str
    otp: str


class ForgotPasswordResetRequest(BaseModel):
    email: str
    reset_token: str
    new_password: str
