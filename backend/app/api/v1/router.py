from fastapi import APIRouter

from app.api.v1.activity_logs import platform_activity_router, tenant_activity_router
from app.api.v1.auth import router as auth_router
from app.api.v1.company_defaults import router as company_defaults_router
from app.api.v1.company_settings import router as company_settings_router
from app.api.v1.health import router as health_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.platform import router as platform_router
from app.api.v1.tenant import router as tenant_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(organizations_router)
api_router.include_router(tenant_router)
api_router.include_router(company_settings_router)
api_router.include_router(company_defaults_router)
api_router.include_router(tenant_activity_router)
api_router.include_router(platform_router)
api_router.include_router(platform_activity_router)
