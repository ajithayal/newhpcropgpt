"""
Alembic migration to add storage management tables.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20231116_02_add_storage_models"
# The previous head revision is 001_reconcile_operations
down_revision = "001_reconcile_operations"
branch_labels = None
depends_on = None


def upgrade():
    # ------------------------------------------------------------
    # Physical Disks
    # ------------------------------------------------------------
    op.create_table(
        "physical_disks",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("device_name", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("manufacturer", sa.String(), nullable=True),
        sa.Column("serial_number", sa.String(), nullable=True),
        sa.Column("wwn", sa.String(), nullable=True),
        sa.Column("disk_type", sa.String(), nullable=True),
        sa.Column("capacity_bytes", sa.Float(), nullable=True),
        sa.Column("sector_size", sa.Integer(), nullable=True),
        sa.Column("logical_sector_size", sa.Integer(), nullable=True),
        sa.Column("health_status", sa.String(), nullable=True),
        sa.Column("smart_status", sa.String(), nullable=True),
        sa.Column("raid_status", sa.String(), nullable=True),
        sa.Column("is_boot_disk", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_mounted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("available_capacity_bytes", sa.Float(), nullable=True),
        sa.Column("discovery_timestamp", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_physical_disks_node_id", "physical_disks", ["node_id"])

    # ------------------------------------------------------------
    # Partitions
    # ------------------------------------------------------------
    op.create_table(
        "partitions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("physical_disk_id", sa.Integer(), sa.ForeignKey("physical_disks.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("partition_name", sa.String(), nullable=False),
        sa.Column("partition_number", sa.Integer(), nullable=True),
        sa.Column("size_bytes", sa.Float(), nullable=True),
        sa.Column("filesystem_type", sa.String(), nullable=True),
        sa.Column("filesystem_uuid", sa.String(), nullable=True),
        sa.Column("mount_point", sa.String(), nullable=True),
        sa.Column("used_bytes", sa.Float(), nullable=True),
        sa.Column("available_bytes", sa.Float(), nullable=True),
        sa.Column("partition_type", sa.String(), nullable=True),
        sa.Column("lvm_status", sa.String(), nullable=True),
        sa.Column("raid_status", sa.String(), nullable=True),
        sa.Column("mount_status", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_partitions_disk_id", "partitions", ["physical_disk_id"])

    # ------------------------------------------------------------
    # Storage Volumes
    # ------------------------------------------------------------
    op.create_table(
        "storage_volumes",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Float(), nullable=True),
        sa.Column("filesystem_type", sa.String(), nullable=True),
        sa.Column("mount_point", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_storage_volumes_node_id", "storage_volumes", ["node_id"])

    # ------------------------------------------------------------
    # Volume Groups
    # ------------------------------------------------------------
    op.create_table(
        "volume_groups",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_volume_groups_node_id", "volume_groups", ["node_id"])

    # ------------------------------------------------------------
    # Logical Volumes
    # ------------------------------------------------------------
    op.create_table(
        "logical_volumes",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("vg_id", sa.Integer(), sa.ForeignKey("volume_groups.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("size_bytes", sa.Float(), nullable=True),
        sa.Column("filesystem_type", sa.String(), nullable=True),
        sa.Column("mount_point", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_logical_volumes_vg_id", "logical_volumes", ["vg_id"])

    # ------------------------------------------------------------
    # Storage Discoveries
    # ------------------------------------------------------------
    op.create_table(
        "storage_discoveries",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("discovery_timestamp", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("raw_data", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="completed"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_storage_discoveries_node_id", "storage_discoveries", ["node_id"])

    # ------------------------------------------------------------
    # NFS Mounts (client side)
    # ------------------------------------------------------------
    op.create_table(
        "nfs_mounts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("client_node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("server_ip", sa.String(), nullable=False),
        sa.Column("export_path", sa.String(), nullable=False),
        sa.Column("mount_point", sa.String(), nullable=False),
        sa.Column("mount_options", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_nfs_mounts_client_node_id", "nfs_mounts", ["client_node_id"])

    # ------------------------------------------------------------
    # Storage Operations
    # ------------------------------------------------------------
    op.create_table(
        "storage_operations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("operation_uuid", sa.String(), nullable=False, unique=True),
        sa.Column("cluster_id", sa.Integer(), sa.ForeignKey("clusters.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("disk_id", sa.Integer(), sa.ForeignKey("physical_disks.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("operation_type", sa.String(), nullable=False),
        sa.Column("requested_configuration", sa.JSON(), nullable=True),
        sa.Column("generated_commands", sa.JSON(), nullable=True),
        sa.Column("execution_status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("approval_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approval_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("rollback_metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )
    op.create_index("ix_storage_operations_cluster_id", "storage_operations", ["cluster_id"])
    op.create_index("ix_storage_operations_node_id", "storage_operations", ["node_id"])
    op.create_index("ix_storage_operations_disk_id", "storage_operations", ["disk_id"])

    # ------------------------------------------------------------
    # Storage Operation Logs
    # ------------------------------------------------------------
    op.create_table(
        "storage_operation_logs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("operation_id", sa.Integer(), sa.ForeignKey("storage_operations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("level", sa.String(), nullable=False, server_default="info"),
    )
    op.create_index("ix_storage_operation_logs_operation_id", "storage_operation_logs", ["operation_id"])

    # ------------------------------------------------------------
    # Storage Operation Approvals
    # ------------------------------------------------------------
    op.create_table(
        "storage_operation_approvals",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("operation_id", sa.Integer(), sa.ForeignKey("storage_operations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("approved_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_storage_operation_approvals_operation_id", "storage_operation_approvals", ["operation_id"])

    # ------------------------------------------------------------
    # Storage Backup Metadata
    # ------------------------------------------------------------
    op.create_table(
        "storage_backup_metadata",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("node_id", sa.Integer(), sa.ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("disk_id", sa.Integer(), sa.ForeignKey("physical_disks.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("backup_path", sa.String(), nullable=False),
        sa.Column("backup_type", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_storage_backup_metadata_node_id", "storage_backup_metadata", ["node_id"])

    # Existing NFS Exports and User Quotas are already defined in storage_models.py – no need to recreate.


def downgrade():
    # Drop tables in reverse order to satisfy FK constraints.
    op.drop_table("storage_backup_metadata")
    op.drop_table("storage_operation_approvals")
    op.drop_table("storage_operation_logs")
    op.drop_table("storage_operations")
    op.drop_table("nfs_mounts")
    op.drop_table("storage_discoveries")
    op.drop_table("logical_volumes")
    op.drop_table("volume_groups")
    op.drop_table("storage_volumes")
    op.drop_table("partitions")
    op.drop_table("physical_disks")
