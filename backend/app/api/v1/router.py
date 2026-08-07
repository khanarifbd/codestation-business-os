from fastapi import APIRouter

from app.api.v1.activity_logs import platform_activity_router, tenant_activity_router
from app.api.v1.auth import router as auth_router
from app.api.v1.company_defaults import router as company_defaults_router
from app.api.v1.company_settings import router as company_settings_router
from app.api.v1.company_uploads import router as company_uploads_router
from app.api.v1.crm import router as crm_router
from app.api.v1.crm_status import router as crm_status_router
from app.api.v1.crm_summary import router as crm_summary_router
from app.api.v1.health import router as health_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.platform import router as platform_router
from app.api.v1.sales import router as sales_router
from app.api.v1.team import invitation_router, router as team_router
from app.api.v1.tenant import router as tenant_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(invitation_router)
api_router.include_router(organizations_router)
api_router.include_router(tenant_router)
api_router.include_router(team_router)
api_router.include_router(crm_summary_router)
api_router.include_router(crm_status_router)
api_router.include_router(crm_router)
api_router.include_router(sales_router)
api_router.include_router(company_uploads_router)
api_router.include_router(company_settings_router)
api_router.include_router(company_defaults_router)
api_router.include_router(tenant_activity_router)
api_router.include_router(platform_router)
api_router.include_router(platform_activity_router)
