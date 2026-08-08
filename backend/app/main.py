import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.bootstrap import ensure_super_admin

logger = logging.getLogger(__name__)
VAULT_CONFIGURATION_ERROR = "Project credential encryption key is not configured"
VAULT_USER_MESSAGE = "Credentials Vault is temporarily unavailable. Please contact your administrator."


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_super_admin()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)


@app.exception_handler(StarletteHTTPException)
async def safe_http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    status_code = exc.status_code
    if detail == VAULT_CONFIGURATION_ERROR:
        logger.error(
            "Credentials Vault unavailable because PROJECT_CREDENTIAL_ENCRYPTION_KEY is not configured",
            extra={"path": request.url.path},
        )
        detail = VAULT_USER_MESSAGE
        status_code = 503
    return JSONResponse(status_code=status_code, content={"detail": detail}, headers=exc.headers)


@app.middleware("http")
async def request_correlation(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
def root_health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "codestation-business-os-api",
    }
