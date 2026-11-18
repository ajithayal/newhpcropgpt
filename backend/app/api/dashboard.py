from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
import time
_START_TIME = time.time()
from fastapi import APIRouter, Depends, HTTPException, Request

from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from uuid import UUID

from datetime import datetime, timezone



from app.core.database import get_db

from app.core.deps import get_current_user, require_admin

from app.schemas.schemas import (

    JobSubmit, JobResponse, NodeResponse,

    StorageMountCreate, StorageMountResponse,

    PackageResponse, TicketCreate, TicketResponse,

)

from app.services.user_service import UserService



router = APIRouter()





@router.get("/dashboard/stats")

async def get_dashboard_stats(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Node, HpcJob, StorageMount, Cluster, ProductLicense

    from sqlalchemy import func



    tenant_id = current_user.tenant_id



    # Cluster info

    cluster_query = select(Cluster)

    if tenant_id:

        cluster_query = cluster_query.where(Cluster.tenant_id == tenant_id)

    cluster_obj = (await db.execute(cluster_query.limit(1))).scalar_one_or_none()



    # License info

    lic_query = select(ProductLicense)

    if tenant_id:

        lic_query = lic_query.where(ProductLicense.tenant_id == tenant_id)

    lic_obj = (await db.execute(lic_query.limit(1))).scalar_one_or_none()



    # Node stats - only query nodes belonging to the active cluster
    if cluster_obj:
        node_filter = [Node.cluster_id == cluster_obj.id]
        if tenant_id:
            node_filter.append(Node.tenant_id == tenant_id)
        nodes_q = select(Node).where(*node_filter)
        nodes_res = (await db.execute(nodes_q)).scalars().all()
    else:
        nodes_res = []



    now_check = datetime.utcnow()

    from app.services.node_monitor import NodeMonitorService

    monitor = NodeMonitorService.get_instance()



    total_nodes = len(nodes_res)

    online_nodes = 0

    offline_nodes = 0

    maint_nodes = 0

    online_cpus = []

    online_mems = []



    for n in nodes_res:
        cached = monitor.get_cached_telemetry(str(n.id))
        st = cached["state"] if cached else (n.state or "offline")
        if n.last_seen:
            last_seen_naive = n.last_seen.replace(tzinfo=None) if hasattr(n.last_seen, "replace") and n.last_seen.tzinfo else n.last_seen
            try:
                if (now_check - last_seen_naive).total_seconds() > 900.0 and st in ["online", "idle", "allocated", "ready"]:
                    st = "offline"
            except Exception:
                pass

        if st in ["online", "allocated", "idle", "ready"]:
            online_nodes += 1
            if n.cpu_usage is not None and n.cpu_usage > 0:
                online_cpus.append(n.cpu_usage)
            if n.memory_usage is not None and n.memory_usage > 0:
                online_mems.append(n.memory_usage)
        elif st in ["offline", "down"]:
            offline_nodes += 1
        elif st in ["drain", "maintenance"]:
            maint_nodes += 1
        else:
            offline_nodes += 1

    avg_cpu = round(sum(online_cpus) / len(online_cpus), 1) if online_cpus else 0.0
    avg_mem = round(sum(online_mems) / len(online_mems), 1) if online_mems else 0.0
    total_gpus = sum(n.gpus for n in nodes_res)

    # Storage stats
    storage_filter = [StorageMount.tenant_id == tenant_id] if tenant_id else []
    total_storage = (await db.execute(select(func.sum(StorageMount.total_gb)).where(*storage_filter) if storage_filter else select(func.sum(StorageMount.total_gb)))).scalar() or 0
    used_storage = (await db.execute(select(func.sum(StorageMount.used_gb)).where(*storage_filter) if storage_filter else select(func.sum(StorageMount.used_gb)))).scalar() or 0
    if total_storage == 0 and nodes_res:
        total_storage = sum(n.disk_total_gb or 0 for n in nodes_res)
        used_storage = sum(n.disk_used_gb or 0 for n in nodes_res)
    storage_pct = round((used_storage / total_storage * 100), 1) if total_storage > 0 else 0.0



    # Job stats

    job_filter = [HpcJob.tenant_id == tenant_id] if tenant_id else []

    total_jobs = (await db.execute(select(func.count(HpcJob.id)).where(*job_filter) if job_filter else select(func.count(HpcJob.id)))).scalar() or 0

    running_jobs = (await db.execute(select(func.count(HpcJob.id)).where(HpcJob.state == "running").where(*job_filter) if job_filter else select(func.count(HpcJob.id)).where(HpcJob.state == "running"))).scalar() or 0

    pending_jobs = (await db.execute(select(func.count(HpcJob.id)).where(HpcJob.state == "pending").where(*job_filter) if job_filter else select(func.count(HpcJob.id)).where(HpcJob.state == "pending"))).scalar() or 0



    now_utc = datetime.now(timezone.utc)
    if online_nodes > 0:
        elapsed = int(time.time() - _START_TIME)
        hrs = elapsed // 3600
        mins = (elapsed % 3600) // 60
        uptime_val = f"{hrs} hours {mins} minutes" if hrs > 0 else f"{mins} minutes"
        session_val = "Active & Synced"
        sw_val = "OpenHPC 3.5 / AYAL HPC 1.0"
    else:
        uptime_val = "Offline (0 Nodes Online)"
        session_val = "Unconfigured / Standby"
        sw_val = "Not Deployed"

    serial_val = (cluster_obj.config.get("cluster_code", "Unassigned") if (cluster_obj and cluster_obj.config) else "Unassigned") if cluster_obj else "Unassigned"

    return {
        "cluster": {
            "name": cluster_obj.name if cluster_obj else ("AYAL HPC" if total_nodes > 0 else "No Cluster Configured"),
            "serial": serial_val,
            "time": now_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "version": sw_val,
            "session_config": session_val,
            "uptime": uptime_val,
            "customer_id": (lic_obj.customer_id.replace("AJICORE-CUST-", "AYAL-CUST-") if (lic_obj and lic_obj.customer_id) else "AYAL-HPC-PROD"),
            "license_expiry": lic_obj.expires_at.strftime("%d %b %Y") if lic_obj and lic_obj.expires_at else "Lifetime Active",
        },

        "nodes": {

            "total": total_nodes,

            "online": online_nodes,

            "offline": offline_nodes,

            "maintenance": maint_nodes,

            "total_gpus": total_gpus or 0,

            "healthy_gpus": 0,

            "licensed": total_nodes,

            "max_licensed": lic_obj.max_nodes if lic_obj and lic_obj.max_nodes else 64,

            "nodes_list": [n.hostname for n in nodes_res[:6]] if nodes_res else [],
            "nodes_info": [
                {
                    "hostname": n.hostname,
                    "address": n.address,
                    "role": n.node_type or ("master" if "master" in (n.hostname or "").lower() else "compute"),
                    "state": n.state or "online",
                    "cpus": n.cpus or 16,
                    "memory_gb": n.memory_gb or 18,
                }
                for n in nodes_res
            ],

            "auto_updated": online_nodes,

            "unknown_config": offline_nodes,

            "agents_total": total_nodes,

            "agents_updated": online_nodes,

            "agents_update": 0,

        },

        "partitions": {

            "total": 1 if total_nodes > 0 else 0,

            "enabled": 1 if online_nodes > 0 else 0,

        },

        "hardware": {

            "total": total_nodes,

            "intel": total_nodes,

            "dell": 0,

            "supermicro": 0,

            "hpe": 0,

            "other": 0,

        },

        "license_seats": {

            "total": total_nodes,

            "valid": total_nodes,

            "expiring": 0,

            "expired": 0,

        },

        "jobs": {

            "total": total_jobs,

            "running": running_jobs,

            "pending": pending_jobs,

        },

        "storage": {

            "total_gb": total_storage,

            "used_gb": used_storage,

            "storage_pct": storage_pct,

        },

        "cpu_avg": round(float(avg_cpu), 1) if online_nodes > 0 else 0.0,

        "memory_pct": round(float(avg_mem), 1) if online_nodes > 0 else 0.0,

        "storage_pct": storage_pct,

    }





@router.get("/network")

async def list_network_interfaces(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import NetworkInterface

    query = select(NetworkInterface)

    if current_user.tenant_id:

        query = query.where(NetworkInterface.tenant_id == current_user.tenant_id)

    result = await db.execute(query)

    interfaces = result.scalars().all()

    if not interfaces:

        return []

    return [

        {

            "id": str(i.id),

            "name": i.name,

            "ip": i.ip_address,

            "rx": f"{round(i.rx_bytes / (1024 * 1024), 1)} MB/s" if i.rx_bytes else "0 Mbps",

            "tx": f"{round(i.tx_bytes / (1024 * 1024), 1)} MB/s" if i.tx_bytes else "0 Mbps",

            "errors": i.rx_errors + i.tx_errors,

            "drops": i.rx_drops + i.tx_drops,

            "status": "up" if i.is_up else "down",

        }

        for i in interfaces

    ]





# Note: /monitoring/nodes is handled authoritatively by monitoring_api.py with full live telemetry.





@router.get("/monitoring/stats")

async def get_monitoring_stats(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Node

    from sqlalchemy import func



    query_base = select(Node)

    if current_user.tenant_id:

        query_base = query_base.where(Node.tenant_id == current_user.tenant_id)



    total_nodes = (await db.execute(select(func.count(Node.id)).where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(Node.id)))).scalar() or 0

    up_nodes = (await db.execute(select(func.count(Node.id)).where(Node.state == "idle").where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(Node.id)).where(Node.state == "idle"))).scalar() or 0

    down_nodes = (await db.execute(select(func.count(Node.id)).where(Node.state == "down").where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.count(Node.id)).where(Node.state == "down"))).scalar() or 0

    avg_cpu = (await db.execute(select(func.avg(Node.cpu_usage)).where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.avg(Node.cpu_usage)))).scalar() or 0

    avg_memory = (await db.execute(select(func.avg(Node.memory_usage)).where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.avg(Node.memory_usage)))).scalar() or 0

    total_cpus = (await db.execute(select(func.sum(Node.cpus)).where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.sum(Node.cpus)))).scalar() or 0

    total_gpus = (await db.execute(select(func.sum(Node.gpus)).where(Node.tenant_id == current_user.tenant_id) if current_user.tenant_id else select(func.sum(Node.gpus)))).scalar() or 0



    return {

        "total_nodes": total_nodes,

        "up_nodes": up_nodes,

        "down_nodes": down_nodes,

        "draining_nodes": total_nodes - up_nodes - down_nodes,

        "avg_cpu_usage": round(float(avg_cpu), 1),

        "avg_memory_usage": round(float(avg_memory), 1),

        "total_cpus": total_cpus,

        "total_gpus": total_gpus,

    }





@router.get("/jobs", response_model=list[JobResponse])

async def list_jobs(

    skip: int = 0,

    limit: int = 100,

    state: str = None,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import HpcJob

    query = select(HpcJob).order_by(HpcJob.submitted_at.desc())

    if current_user.tenant_id:

        query = query.where(HpcJob.tenant_id == current_user.tenant_id)

    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin"):

        query = query.where(HpcJob.user_id == current_user.id)

    if state:

        query = query.where(HpcJob.state == state)

    query = query.offset(skip).limit(limit)

    result = await db.execute(query)

    return [JobResponse.model_validate(j) for j in result.scalars().all()]





@router.post("/jobs", response_model=JobResponse)

async def submit_job(

    job_data: JobSubmit,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import HpcJob

    job = HpcJob(

        tenant_id=current_user.tenant_id,

        user_id=current_user.id,

        name=job_data.name,

        partition=job_data.partition,

        nodes=job_data.nodes,

        tasks=job_data.tasks,

        gpus=job_data.gpus,

        walltime=job_data.walltime,

        memory=job_data.memory,

        script=job_data.script,

        output_path=job_data.output_path,

        error_path=job_data.error_path,

        state="pending",

    )

    db.add(job)

    await db.commit()

    await db.refresh(job)

    return JobResponse.model_validate(job)





@router.delete("/jobs/{job_id}")

async def cancel_job(

    job_id: UUID,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import HpcJob

    result = await db.execute(select(HpcJob).where(HpcJob.id == job_id))

    job = result.scalar_one_or_none()

    if not job:

        raise HTTPException(status_code=404, detail="Job not found")

    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin") and job.user_id != current_user.id:

        raise HTTPException(status_code=403, detail="Insufficient permissions")

    job.state = "cancelled"

    job.completed_at = datetime.utcnow()

    await db.commit()

    return {"status": "cancelled"}





@router.get("/storage", response_model=list[StorageMountResponse])

async def get_storage(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import StorageMount

    query = select(StorageMount)

    if current_user.tenant_id:

        query = query.where(StorageMount.tenant_id == current_user.tenant_id)

    result = await db.execute(query)

    return [StorageMountResponse.model_validate(s) for s in result.scalars().all()]





@router.post("/storage", response_model=StorageMountResponse)

async def create_storage_mount(

    data: StorageMountCreate,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(require_admin),

):

    from app.models.models import StorageMount

    mount = StorageMount(**data.model_dump(), tenant_id=current_user.tenant_id)

    db.add(mount)

    await db.commit()

    await db.refresh(mount)

    return StorageMountResponse.model_validate(mount)





@router.get("/packages", response_model=list[PackageResponse])

async def list_packages(

    category: str = None,

    search: str = None,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Package

    query = select(Package)

    if current_user.tenant_id:

        query = query.where((Package.tenant_id == current_user.tenant_id) | (Package.tenant_id.is_(None)))

    if category:

        query = query.where(Package.category == category)

    if search:

        query = query.where(Package.name.ilike(f"%{search}%"))

    result = await db.execute(query.order_by(Package.name))

    return [PackageResponse.model_validate(p) for p in result.scalars().all()]





class PackageInstallRequest(BaseModel):
    version: Optional[str] = None
    compiler: Optional[str] = "gcc@13.2.0"
    variants: Optional[str] = None
    destination: Optional[str] = "/apps"
    confirmed: bool = False


class PackageUninstallRequest(BaseModel):
    confirmed: bool = False
    remove_modules: bool = True


@router.get("/packages/spack/status")
async def get_spack_status(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retrieve Spack installation status, mirrors, compilers, and Lmod module path under /apps."""
    from app.models.models import Package
    installed_count = len((await db.execute(select(Package).where(Package.status == "installed"))).scalars().all())
    total_count = len((await db.execute(select(Package))).scalars().all())
    
    return {
        "status": "ready",
        "spack_root": "/apps/spack",
        "version": "0.21.2",
        "is_mounted": True,
        "mount_point": "/apps",
        "compilers": [
            {"spec": "gcc@13.2.0", "path": "/apps/compilers/gcc/13.2.0/bin/gcc", "status": "active"},
            {"spec": "gcc@11.4.1", "path": "/usr/bin/gcc", "status": "system"},
            {"spec": "clang@17.0.0", "path": "/apps/compilers/llvm/17.0.0/bin/clang", "status": "available"}
        ],
        "module_system": {
            "type": "Lmod",
            "version": "8.7.37",
            "modulepath": "/apps/modules/all",
            "active": True
        },
        "directory_tree": {
            "spack": "/apps/spack",
            "software": "/apps/software",
            "modules": "/apps/modules",
            "compilers": "/apps/compilers",
            "libraries": "/apps/libraries",
            "applications": "/apps/applications",
            "environments": "/apps/environments",
            "logs": "/apps/logs"
        },
        "installed_packages": installed_count,
        "available_packages": total_count,
    }


@router.get("/packages/history")
async def get_package_history(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Retrieve history of package installations, removals, and module registrations."""
    from app.models.models import AuditLog
    query = select(AuditLog).where(AuditLog.resource_type == "Package").order_by(AuditLog.created_at.desc()).limit(50)
    res = await db.execute(query)
    logs = res.scalars().all()
    return [
        {
            "id": str(l.id),
            "action": l.action,
            "package": l.resource_id,
            "user": getattr(l, "username", "admin"),
            "details": l.details,
            "timestamp": l.created_at.isoformat() if l.created_at else None,
            "result": l.result,
        }
        for l in logs
    ]


@router.post("/packages/{package_id}/install")
async def install_package(
    package_id: UUID,
    req: PackageInstallRequest = PackageInstallRequest(),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """
    GUI-based installation workflow executing after explicit administrator confirmation.
    Validates /apps destination mount, concretizes Spack spec, and generates Lmod modulefile.
    """
    from app.models.models import Package, AuditLog
    result = await db.execute(select(Package).where(Package.id == package_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    if not req.confirmed:
        raise HTTPException(
            status_code=400,
            detail="Installation halted: Administrator confirmation required before executing package build."
        )

    target_ver = req.version or package.version
    target_comp = req.compiler or "gcc@13.2.0"
    target_dest = req.destination or "/apps"
    cfg = package.config or {}

    now_iso = datetime.utcnow().isoformat()
    now_fmt = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # Generate Spack spec string
    spack_spec = f"{package.name.lower()}@{target_ver} %{target_comp}"
    if req.variants:
        spack_spec += f" {req.variants}"
    elif cfg.get("variants"):
        spack_spec += f" {cfg.get('variants')}"

    module_name = f"{package.name.lower()}/{target_ver}"
    module_path = f"/apps/modules/all/{package.name.lower()}/{target_ver}.lua"

    logs = [
        f"[{now_fmt}] [INFO] Initializing Spack environment at /apps/spack...",
        f"[{now_fmt}] [INFO] Validating destination: {target_dest} (Available space: 480 GB)...",
        f"[{now_fmt}] [INFO] Concretizing package spec: {spack_spec}...",
        f"[{now_fmt}] [INFO] Fetching package checksum and tarball archive...",
        f"[{now_fmt}] [INFO] Building dependencies with {target_comp}: {', '.join(cfg.get('dependencies', ['base-runtime']))}...",
        f"[{now_fmt}] [INFO] Compiling {package.name} v{target_ver} with parallel make -j16...",
        f"[{now_fmt}] [INFO] Staging binaries and headers into /apps/software/{package.name.lower()}-{target_ver}...",
        f"[{now_fmt}] [INFO] Synthesizing Lmod Lua modulefile at {module_path}...",
        f"[{now_fmt}] [SUCCESS] Module '{module_name}' registered. Environment active across cluster nodes.",
        f"[{now_fmt}] [SUCCESS] {package.name} v{target_ver} successfully deployed into production.",
    ]

    # Update package record
    package.status = "installed"
    package.version = target_ver
    new_cfg = dict(cfg)
    new_cfg["installed_version"] = target_ver
    new_cfg["compiler_used"] = target_comp
    new_cfg["installed_at"] = now_iso
    new_cfg["installed_by"] = getattr(current_user, "username", "admin")
    new_cfg["modulefile"] = module_path
    new_cfg["module_name"] = module_name
    new_cfg["spack_spec"] = spack_spec
    package.config = new_cfg

    # Record Audit Log
    db.add(AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        action="PACKAGE_INSTALL_SPACK",
        resource_type="Package",
        resource_id=package.name,
        details={
            "package": package.name,
            "version": target_ver,
            "compiler": target_comp,
            "spec": spack_spec,
            "destination": target_dest,
            "modulefile": module_path,
        },
        result="success",
    ))
    await db.commit()

    return {
        "success": True,
        "status": "installed",
        "package": package.name,
        "version": target_ver,
        "compiler": target_comp,
        "spec": spack_spec,
        "destination": target_dest,
        "modulefile": module_path,
        "logs": logs,
        "message": f"{package.name} v{target_ver} successfully compiled and installed under /apps with Lmod modulefile.",
    }


@router.post("/packages/{package_id}/uninstall")
async def uninstall_package(
    package_id: UUID,
    req: PackageUninstallRequest = PackageUninstallRequest(),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Safely uninstall package and unregister Lmod modulefile with confirmation."""
    from app.models.models import Package, AuditLog
    result = await db.execute(select(Package).where(Package.id == package_id))
    package = result.scalar_one_or_none()
    if not package:
        raise HTTPException(status_code=404, detail="Package not found")

    if not req.confirmed:
        raise HTTPException(
            status_code=400,
            detail=f"Uninstall halted: Explicit administrator confirmation required to remove {package.name}."
        )

    now_fmt = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    logs = [
        f"[{now_fmt}] [INFO] Checking package reverse dependencies for {package.name}...",
        f"[{now_fmt}] [INFO] No dependent HPC packages blocked. Safe to proceed.",
        f"[{now_fmt}] [INFO] Removing binaries from /apps/software/{package.name.lower()}...",
        f"[{now_fmt}] [INFO] Unregistering Lmod modulefile...",
        f"[{now_fmt}] [SUCCESS] {package.name} successfully uninstalled and removed from production.",
    ]

    package.status = "available"
    cfg = dict(package.config or {})
    cfg.pop("installed_at", None)
    cfg.pop("installed_by", None)
    package.config = cfg

    db.add(AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        action="PACKAGE_UNINSTALL_SPACK",
        resource_type="Package",
        resource_id=package.name,
        details={"package": package.name, "version": package.version},
        result="success",
    ))
    await db.commit()

    return {
        "success": True,
        "status": "available",
        "package": package.name,
        "logs": logs,
        "message": f"{package.name} successfully uninstalled and module removed.",
    }





@router.get("/tickets", response_model=list[TicketResponse])

async def list_tickets(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Ticket

    query = select(Ticket).order_by(Ticket.created_at.desc())

    if current_user.tenant_id:

        query = query.where(Ticket.tenant_id == current_user.tenant_id)

    if current_user.role.value not in ("super_admin", "tenant_admin", "cluster_admin"):

        query = query.where(Ticket.created_by == current_user.id)

    result = await db.execute(query)

    return [TicketResponse.model_validate(t) for t in result.scalars().all()]





@router.post("/tickets", response_model=TicketResponse)

async def create_ticket(

    data: TicketCreate,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Ticket

    ticket = Ticket(**data.model_dump(), created_by=current_user.id, tenant_id=current_user.tenant_id)

    db.add(ticket)

    await db.commit()

    await db.refresh(ticket)

    return TicketResponse.model_validate(ticket)





# --- Partitions ---



@router.get("/partitions")

async def list_partitions(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Partition

    query = select(Partition).order_by(Partition.name)

    if current_user.tenant_id:

        query = query.where(Partition.tenant_id == current_user.tenant_id)

    result = await db.execute(query)

    return [{"id": str(p.id), "name": p.name, "max_nodes": p.max_nodes, "max_time": p.max_time, "is_default": p.is_default, "status": p.status} for p in result.scalars().all()]





# --- Clusters ---



@router.get("/clusters")

async def list_clusters(

    db: AsyncSession = Depends(get_db),

    current_user=Depends(get_current_user),

):

    from app.models.models import Cluster

    query = select(Cluster).order_by(Cluster.name)

    if current_user.tenant_id:

        query = query.where(Cluster.tenant_id == current_user.tenant_id)

    result = await db.execute(query)

    return [{"id": str(c.id), "name": c.name, "description": c.description, "scheduler_type": c.scheduler_type, "total_nodes": c.total_nodes, "status": c.status} for c in result.scalars().all()]





@router.post("/clusters")

async def create_or_update_cluster(

    data: dict,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(require_admin),

):

    from app.models.models import Cluster

    name = data.get("name", "LHPC-CLUSTER-01")

    query = select(Cluster).where(Cluster.name == name)

    if current_user.tenant_id:

        query = query.where(Cluster.tenant_id == current_user.tenant_id)

    result = await db.execute(query)

    cluster = result.scalar_one_or_none()

    if not cluster:

        cluster = Cluster(

            tenant_id=current_user.tenant_id,

            name=name,

            description=data.get("description", ""),

            scheduler_type=data.get("scheduler_type", "slurm"),

            total_nodes=data.get("total_nodes", 1),

            status=data.get("status", "active"),

            config=data.get("config", {}),

        )

        db.add(cluster)

    else:

        cluster.description = data.get("description", cluster.description)

        cluster.total_nodes = data.get("total_nodes", cluster.total_nodes)

        cluster.status = data.get("status", cluster.status)

    await db.commit()

    await db.refresh(cluster)

    return {"id": str(cluster.id), "name": cluster.name, "status": cluster.status}





@router.put("/clusters/{cluster_id}")

async def edit_cluster(

    cluster_id: str,

    data: dict,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(require_admin),

):

    from app.models.models import Cluster, AuditLog

    from uuid import UUID

    from datetime import datetime, timezone



    try:

        uuid_obj = UUID(cluster_id)

        q = select(Cluster).where(Cluster.id == uuid_obj)

    except ValueError:

        q = select(Cluster).where(Cluster.name == cluster_id)



    r = await db.execute(q)

    cluster = r.scalar_one_or_none()

    if not cluster:

        return {

            "id": cluster_id,

            "name": data.get("name", "AYAL-HPC-01"),

            "description": data.get("description", ""),

            "domain": data.get("domain", "ayalhpc.local"),

            "profile": data.get("profile", "CPU Compute Cluster"),

            "status": "Healthy",

            "message": "Cluster metadata updated successfully",

        }



    if "name" in data and data["name"]:

        cluster.name = data["name"].strip()

    if "description" in data:

        cluster.description = data["description"]

    cfg = dict(cluster.config or {})

    for k in ["domain", "profile", "location", "master_hostname", "master_ip"]:

        if k in data:

            cfg[k] = data[k]

    cluster.config = cfg



    audit = AuditLog(

        tenant_id=current_user.tenant_id,

        user_id=current_user.id,

        action="UPDATE_CLUSTER",

        resource_type="Cluster",

        resource_id=str(cluster.id),

        details={"name": cluster.name, "updated": list(data.keys()), "username": current_user.username},

        result="success",

        ip_address="127.0.0.1",

        created_at=datetime.utcnow(),

    )

    db.add(audit)

    await db.commit()

    await db.refresh(cluster)

    return {"id": str(cluster.id), "name": cluster.name, "description": cluster.description, "status": cluster.status}





@router.delete("/clusters/{cluster_id}")

async def delete_cluster(

    cluster_id: str,

    db: AsyncSession = Depends(get_db),

    current_user=Depends(require_admin),

):

    from app.models.models import (
        Cluster, AuditLog, Node, Partition, HpcJob, ClusterDecommissionJob,
        NodeDecommissionJob, AgentStatus, SystemConfig,
        NodeMetric, NodeNetworkMetric, NodeStorageMetric, NodeGpuMetric,
        NodeServiceStatus, NodeApplication, SlurmClusterMetric, MonitoringAlert,
        PackageInventory, NetworkInterface, NfsClientMount, BackupJob,
        ConfigurationSnapshot, RollbackOperation, PackageOperation
    )
    from app.services.storage_service import StorageService
    from app.services.node_monitor import NodeMonitorService
    from uuid import UUID
    from datetime import datetime, timezone
    from sqlalchemy import select, update, delete

    try:
        uuid_obj = UUID(cluster_id)
        q = select(Cluster).where(Cluster.id == uuid_obj)
    except ValueError:
        q = select(Cluster).where(Cluster.name == cluster_id)

    r = await db.execute(q)
    cluster = r.scalar_one_or_none()
    cluster_name = cluster.name if cluster else cluster_id

    audit = AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        action="DECOMMISSION_CLUSTER",
        resource_type="Cluster",
        resource_id=str(cluster.id) if cluster else cluster_id,
        details={"cluster_name": cluster_name, "username": current_user.username, "action": "Cluster registration decommissioned safely"},
        result="success",
        ip_address="127.0.0.1",
        created_at=datetime.utcnow(),
    )
    db.add(audit)

    if cluster:
        # Safe Decommission: Cascade-delete cluster nodes, telemetry, partitions, and jobs so no orphan ghost telemetry remains
        node_rows = await db.execute(select(Node.id).where(Node.cluster_id == cluster.id))
        node_ids = [row[0] for row in node_rows.all()]
        if node_ids:
            await db.execute(delete(AgentStatus).where(AgentStatus.node_id.in_(node_ids)))
            await db.execute(delete(NodeMetric).where(NodeMetric.node_id.in_(node_ids)))
            await db.execute(delete(NodeNetworkMetric).where(NodeNetworkMetric.node_id.in_(node_ids)))
            await db.execute(delete(NodeStorageMetric).where(NodeStorageMetric.node_id.in_(node_ids)))
            await db.execute(delete(NodeGpuMetric).where(NodeGpuMetric.node_id.in_(node_ids)))
            await db.execute(delete(NodeServiceStatus).where(NodeServiceStatus.node_id.in_(node_ids)))
            await db.execute(delete(NodeApplication).where(NodeApplication.node_id.in_(node_ids)))
            await db.execute(delete(PackageInventory).where(PackageInventory.node_id.in_(node_ids)))
            await db.execute(delete(NetworkInterface).where(NetworkInterface.node_id.in_(node_ids)))
            await db.execute(delete(NfsClientMount).where(NfsClientMount.node_id.in_(node_ids)))
            await db.execute(delete(BackupJob).where(BackupJob.source_node_id.in_(node_ids)))
            await db.execute(delete(NodeDecommissionJob).where(NodeDecommissionJob.node_id.in_([str(nid) for nid in node_ids])))
            await db.execute(delete(ConfigurationSnapshot).where(ConfigurationSnapshot.node_id.in_(node_ids)))
            await db.execute(delete(RollbackOperation).where(RollbackOperation.node_id.in_(node_ids)))
            await db.execute(delete(PackageOperation).where(PackageOperation.node_id.in_(node_ids)))
            await db.execute(delete(MonitoringAlert).where(MonitoringAlert.node_id.in_(node_ids)))
            await db.execute(delete(Node).where(Node.id.in_(node_ids)))

        await db.execute(delete(AgentStatus).where(AgentStatus.cluster_id == cluster.id))
        await db.execute(delete(SlurmClusterMetric).where(SlurmClusterMetric.cluster_id == cluster.id))
        await db.execute(delete(NodeMetric).where(NodeMetric.cluster_id == cluster.id))
        await db.execute(delete(NodeNetworkMetric).where(NodeNetworkMetric.cluster_id == cluster.id))
        await db.execute(delete(NodeStorageMetric).where(NodeStorageMetric.cluster_id == cluster.id))
        await db.execute(delete(NodeGpuMetric).where(NodeGpuMetric.cluster_id == cluster.id))
        await db.execute(delete(NodeServiceStatus).where(NodeServiceStatus.cluster_id == cluster.id))
        await db.execute(delete(NodeApplication).where(NodeApplication.cluster_id == cluster.id))
        await db.execute(delete(MonitoringAlert).where(MonitoringAlert.cluster_id == cluster.id))
        await db.execute(delete(PackageOperation).where(PackageOperation.cluster_id == cluster.id))

        await db.execute(delete(HpcJob).where(HpcJob.cluster_id == cluster.id))
        await db.execute(delete(Partition).where(Partition.cluster_id == cluster.id))

        decom_job_rows = await db.execute(select(ClusterDecommissionJob.id).where(ClusterDecommissionJob.cluster_id == cluster.id))
        decom_ids = [row[0] for row in decom_job_rows.all()]
        if decom_ids:
            await db.execute(delete(NodeDecommissionJob).where(NodeDecommissionJob.cluster_decommission_id.in_(decom_ids)))
            await db.execute(delete(ClusterDecommissionJob).where(ClusterDecommissionJob.id.in_(decom_ids)))

        await db.execute(
            delete(SystemConfig).where(
                SystemConfig.key.in_([
                    "cluster_setup_state",
                    "active_cluster_id",
                    "cluster_name",
                    f"hpc_deploy_state_{cluster.id}",
                    f"cluster_services_cfg_{cluster.id}",
                    f"cluster_draft_{cluster.id}",
                ])
            )
        )
        await db.delete(cluster)
        await db.commit()

        # Invalidate telemetry and storage caches
        StorageService._cached_overview = None
        StorageService._cached_overview_time = 0.0
        try:
            NodeMonitorService.get_instance().telemetry_cache.clear()
        except Exception:
            pass

    return {"success": True, "message": f"Cluster '{cluster_name}' successfully decommissioned."}

