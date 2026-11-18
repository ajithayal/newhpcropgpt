from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

# Existing models (PhysicalDisk, Partition, NFSExport, UserQuota) are defined in storage_models.py.
# The following additional models extend the storage management schema.

class StorageVolume(Base):
    __tablename__ = "storage_volumes"
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # e.g., /dev/sda1 or LV name
    size_bytes = Column(Float, nullable=True)
    filesystem_type = Column(String, nullable=True)
    mount_point = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    node = relationship("Node", back_populates="storage_volumes")

class VolumeGroup(Base):
    __tablename__ = "volume_groups"
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    size_bytes = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    node = relationship("Node", back_populates="volume_groups")
    logical_volumes = relationship("LogicalVolume", back_populates="vg", cascade="all, delete-orphan")

class LogicalVolume(Base):
    __tablename__ = "logical_volumes"
    id = Column(Integer, primary_key=True, index=True)
    vg_id = Column(Integer, ForeignKey("volume_groups.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    size_bytes = Column(Float, nullable=True)
    filesystem_type = Column(String, nullable=True)
    mount_point = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    vg = relationship("VolumeGroup", back_populates="logical_volumes")

class StorageDiscovery(Base):
    __tablename__ = "storage_discoveries"
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    discovery_timestamp = Column(DateTime(timezone=True), server_default=func.now())
    raw_data = Column(JSON, nullable=True)  # full JSON snapshot from the agent
    status = Column(String, default="completed")
    message = Column(Text, nullable=True)
    node = relationship("Node", back_populates="discoveries")

class NFSMount(Base):
    __tablename__ = "nfs_mounts"
    id = Column(Integer, primary_key=True, index=True)
    client_node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    server_ip = Column(String, nullable=False)
    export_path = Column(String, nullable=False)
    mount_point = Column(String, nullable=False)
    mount_options = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    client_node = relationship("Node", back_populates="nfs_mounts")

class StorageOperation(Base):
    __tablename__ = "storage_operations"
    id = Column(Integer, primary_key=True, index=True)
    operation_uuid = Column(String, nullable=False, unique=True)
    cluster_id = Column(Integer, ForeignKey("clusters.id"), nullable=False, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    disk_id = Column(Integer, ForeignKey("physical_disks.id"), nullable=True)
    operation_type = Column(String, nullable=False)
    requested_configuration = Column(JSON, nullable=True)
    generated_commands = Column(JSON, nullable=True)
    execution_status = Column(String, default="pending")
    approval_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approval_timestamp = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    rollback_metadata = Column(JSON, nullable=True)
    cluster = relationship("Cluster")
    node = relationship("Node")
    disk = relationship("PhysicalDisk")
    approving_user = relationship("User")
    logs = relationship("StorageOperationLog", back_populates="operation", cascade="all, delete-orphan")

class StorageOperationLog(Base):
    __tablename__ = "storage_operation_logs"
    id = Column(Integer, primary_key=True, index=True)
    operation_id = Column(Integer, ForeignKey("storage_operations.id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    message = Column(Text, nullable=False)
    level = Column(String, default="info")
    operation = relationship("StorageOperation", back_populates="logs")

class StorageOperationApproval(Base):
    __tablename__ = "storage_operation_approvals"
    id = Column(Integer, primary_key=True, index=True)
    operation_id = Column(Integer, ForeignKey("storage_operations.id"), nullable=False, index=True)
    approved_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_at = Column(DateTime(timezone=True), server_default=func.now())
    notes = Column(Text, nullable=True)
    operation = relationship("StorageOperation")
    approver = relationship("User")

class StorageBackupMetadata(Base):
    __tablename__ = "storage_backup_metadata"
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    disk_id = Column(Integer, ForeignKey("physical_disks.id"), nullable=True)
    backup_path = Column(String, nullable=False)
    backup_type = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notes = Column(Text, nullable=True)
    node = relationship("Node")
    disk = relationship("PhysicalDisk")
