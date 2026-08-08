import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.bootstrap import ensure_super_admin

logger = logging.getLogger(__name__)
VAULT_CONFIGURATION_ERROR = "Project credential encryption key is not configured"
VAULT_USER_MESSAGE = "Credentials Vault is temporarily unavailable. Please contact your administrator."
CLOSED_PERIOD_MARKER = "Accounting period is closed for date"
CLOSED_PERIOD_USER_MESSAGE = "This accounting period is closed. Reopen it with an audit reason before changing financial records."


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


@app.exception_handler(DBAPIError)
async def safe_database_exception_handler(request: Request, exc: DBAPIError) -> JSONResponse:
    database_message = str(exc.orig)
    if CLOSED_PERIOD_MARKER in database_message:
        logger.info(
            "Blocked financial mutation in closed accounting period",
            extra={"path": request.url.path, "request_id": getattr(request.state, "request_id", None)},
        )
        return JSONResponse(status_code=409, content={"detail": CLOSED_PERIOD_USER_MESSAGE})
    logger.exception(
        "Unhandled database operation error",
        exc_info=exc,
        extra={"path": request.url.path, "request_id": getattr(request.state, "request_id", None)},
    )
    return JSONResponse(status_code=500, content={"detail": "Database operation failed. Please try again or contact your administrator."})


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
