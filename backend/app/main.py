from fastapi.encoders import jsonable_encoder
from contextlib import asynccontextmanager
import os
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.websockets import WebSocket
from app.core.config import settings
from app.core.database import init_db, async_session


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with async_session() as db:
        from app.services.package_service import seed_packages
        from app.core.rbac import RBACService
        await seed_packages(db)
        await RBACService.seed_permissions(db)
        await RBACService.seed_roles(db)

        # Initialize SMTP configuration from environment if configured
        from app.models.models import SystemConfig
        from sqlalchemy import select
        if settings.SMTP_HOST and settings.SMTP_USER:
            smtp_env = {
                "smtp_host": settings.SMTP_HOST,
                "smtp_port": str(settings.SMTP_PORT),
                "smtp_user": settings.SMTP_USER,
                "smtp_password": settings.SMTP_PASSWORD,
                "smtp_from": settings.SMTP_FROM,
                "smtp_verified": bool(settings.SMTP_USER and settings.SMTP_PASSWORD),
                "smtp_provider": "Environment",
            }
            for k, v in smtp_env.items():
                r = await db.execute(select(SystemConfig).where(SystemConfig.key == k))
                row = r.scalar_one_or_none()
                if not row:
                    db.add(SystemConfig(key=k, value=str(v)))
            await db.commit()

    # Start Real-Time Service Health Monitoring loop
    from app.services.service_monitor import ServiceMonitor
    ServiceMonitor.get_instance().start_monitoring()

    # Start Real-Time Node Connectivity & Hardware Monitoring loop
    from app.services.node_monitor import NodeMonitorService
    NodeMonitorService.get_instance().start_monitoring()

    # Start 15s Health Checker loop
    from app.reconcile.health_checker import HealthCheckerService
    HealthCheckerService.get_instance().start()

    # Start Reconcile Worker engine
    from app.reconcile.worker import get_reconcile_worker
    get_reconcile_worker().start()

    yield

    HealthCheckerService.get_instance().stop()
    get_reconcile_worker().stop()
    ServiceMonitor.get_instance().stop_monitoring()
    NodeMonitorService.get_instance().stop_monitoring()


from fastapi.exceptions import RequestValidationError
import logging

app = FastAPI(
    title="AYAL HPC API",
    description="AYAL HPC — High Performance Computing Management Platform",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

validation_logger = logging.getLogger("validation_error")

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    try:
        body = await request.body()
        validation_logger.error(f"422 Validation Error on {request.url.path}: {exc.errors()} | Body: {body.decode('utf-8', errors='ignore')}")
    except Exception:
        pass
    error_msgs = []
    for err in exc.errors():
        field = ".".join(str(loc) for loc in err.get("loc", []) if loc != "body")
        error_msgs.append(f"{field}: {err.get('msg')}" if field else err.get("msg", "Validation error"))
    detail_str = "; ".join(error_msgs) if error_msgs else "Validation failed on submitted data."
    return JSONResponse(
        status_code=422,
        content={"detail": detail_str, "errors": jsonable_encoder(exc.errors())},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def license_enforcement_middleware(request: Request, call_next):
    path = request.url.path
    skip_paths = (
        "/api/setup/",
        "/api/setup",
        "/api/auth/login",
        "/api/health",
        "/api/docs",
        "/api/openapi.json",
        "/api/license/activate",
        "/api/license/status",
        "/api/customer/",
        "/api/agent/",
        "/ws/",
        "/",
        "/login",
    )
    if any(path.startswith(p) for p in skip_paths):
        return await call_next(request)

    if path.startswith("/api/"):
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            from app.core.security import decode_access_token
            payload = decode_access_token(auth.split(" ")[1])
            if payload:
                async with async_session() as db:
                    from app.services.setup_service import SetupService
                    from app.services.license_service import LicenseService

                    tenant_id = await SetupService.get_tenant_id_from_config(db)
                    if tenant_id:
                        lic_valid = await LicenseService.is_license_valid_for_tenant(db, tenant_id)
                        if not lic_valid:
                            return JSONResponse(
                                status_code=402,
                                content={
                                    "detail": "License expired or not activated. Please contact support.",
                                    "license_required": True,
                                },
                            )

    return await call_next(request)


from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.admin import router as admin_router
from app.api.dashboard import router as dashboard_router
from app.api.license import router as license_router
from app.api.nodes import router as nodes_router
from app.api.files import router as files_router
from app.api.services_api import router as services_router
from app.api.scheduler import router as scheduler_router
from app.api.backups import router as backups_router
from app.api.cluster_setup import router as cluster_setup_router
from app.api.cluster_config import router as cluster_config_router
from app.api.identity_api import router as identity_router
from app.api.storage_api import router as storage_router
from app.api.power_api import router as power_router
from app.api.bmc_api import router as bmc_router
from app.api.operations_api import router as operations_router
from app.api.apps_storage_api import router as apps_storage_router
from app.api.node_operations_api import router as node_operations_router
from app.api.fresh_config_api import router as fresh_config_router
from app.api.cluster_decommission_api import router as cluster_decommission_router
from app.api.node_rollback_api import router as node_rollback_router
from app.api.application_management_api import router as app_mgmt_router
from app.api.agent_api import router as agent_router
from app.api.monitoring_api import router as monitoring_router
from app.api.agents import router as agents_router
from app.api.clusters_api import router as clusters_api_router
from app.api.database_admin_api import router as database_admin_router
from app.api.v1 import api_v1_router

app.include_router(api_v1_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(clusters_api_router, prefix="/api")
app.include_router(database_admin_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(license_router, prefix="/api")
app.include_router(nodes_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(services_router, prefix="/api")
app.include_router(scheduler_router, prefix="/api")
app.include_router(backups_router, prefix="/api")
app.include_router(cluster_setup_router, prefix="/api")
app.include_router(cluster_config_router, prefix="/api")
app.include_router(identity_router, prefix="/api")
app.include_router(storage_router, prefix="/api")
app.include_router(power_router, prefix="/api")
app.include_router(bmc_router, prefix="/api")
app.include_router(operations_router, prefix="/api")
app.include_router(apps_storage_router, prefix="/api")
app.include_router(node_operations_router, prefix="/api")
app.include_router(fresh_config_router, prefix="/api")
app.include_router(cluster_decommission_router, prefix="/api")
app.include_router(node_rollback_router, prefix="/api")
app.include_router(app_mgmt_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
app.include_router(monitoring_router, prefix="/api")


@app.get("/api")
async def root():
    return {"name": "AYAL HPC", "version": "1.0.0", "docs": "/api/docs"}


@app.websocket("/ws")
async def websocket_route(websocket: WebSocket, token: str = None):
    from app.api.websocket import websocket_endpoint
    await websocket_endpoint(websocket, token)
