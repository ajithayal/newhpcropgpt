"""
Storage related ORM models for AYAL HPC.
"""

from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Enum, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base

class PhysicalDisk(Base):
    __tablename__ = "physical_disks"
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    device_name = Column(String, nullable=False)  # e.g., /dev/sda
    model = Column(String, nullable=True)
    manufacturer = Column(String, nullable=True)
    serial_number = Column(String, nullable=True)
    wwn = Column(String, nullable=True)
    disk_type = Column(String, nullable=True)  # HDD / SSD / NVMe
    capacity_bytes = Column(Float, nullable=True)
    sector_size = Column(Integer, nullable=True)
    logical_sector_size = Column(Integer, nullable=True)
    health_status = Column(String, nullable=True)
    smart_status = Column(String, nullable=True)
    raid_status = Column(String, nullable=True)
    is_boot_disk = Column(Boolean, default=False)
    is_mounted = Column(Boolean, default=False)
    available_capacity_bytes = Column(Float, nullable=True)
    discovery_timestamp = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    partitions = relationship("Partition", back_populates="disk", cascade="all, delete-orphan")

class Partition(Base):
    __tablename__ = "partitions"
    id = Column(Integer, primary_key=True, index=True)
    disk_id = Column(Integer, ForeignKey("physical_disks.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # e.g., /dev/sda1
    number = Column(Integer, nullable=True)
    size_gb = Column(Float, nullable=True)
    filesystem = Column(String, nullable=True)
    uuid = Column(String, nullable=True)
    mount_point = Column(String, nullable=True)
    used_gb = Column(Float, nullable=True)
    available_gb = Column(Float, nullable=True)
    partition_table = Column(String, nullable=True)  # GPT / MBR
    lvm_vg = Column(String, nullable=True)
    lvm_lv = Column(String, nullable=True)
    raid = Column(String, nullable=True)
    boot = Column(Boolean, default=False)
    mounted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    disk = relationship("PhysicalDisk", back_populates="partitions")

class NFSExport(Base):
    __tablename__ = "nfs_exports"
    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("nodes.id"), nullable=False, index=True)
    path = Column(String, nullable=False)
    allowed_clients = Column(String, nullable=True)  # comma‑separated IPs or '*'
    access = Column(String, default="rw")
    root_squash = Column(String, default="no_root_squash")
    sync_mode = Column(String, default="sync")
    extra_options = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class UserQuota(Base):
    __tablename__ = "user_quotas"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    quota_gb = Column(Float, nullable=False)
    path = Column(String, nullable=False)  # e.g., /home/username
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
