from fastapi import APIRouter
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
from app.api.identity_api import router as identity_router
from app.api.storage_api import router as storage_router
from app.api.operations_api import router as operations_router
from app.api.apps_storage_api import router as apps_storage_router

api_v1_router = APIRouter(prefix="/v1")
api_v1_router.include_router(auth_router)
api_v1_router.include_router(users_router)
api_v1_router.include_router(admin_router)
api_v1_router.include_router(dashboard_router)
api_v1_router.include_router(license_router)
api_v1_router.include_router(nodes_router)
api_v1_router.include_router(files_router)
api_v1_router.include_router(services_router)
api_v1_router.include_router(scheduler_router)
api_v1_router.include_router(backups_router)
api_v1_router.include_router(cluster_setup_router)
api_v1_router.include_router(identity_router)
api_v1_router.include_router(storage_router)
api_v1_router.include_router(operations_router)
api_v1_router.include_router(apps_storage_router)

__all__ = ["api_v1_router"]
