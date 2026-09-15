import logging
import re
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.bootstrap import ensure_super_admin
from app.services.performance_metrics import (
    build_request_performance_breakdown,
    finish_request_metrics,
    start_request_metrics,
)

logger = logging.getLogger(__name__)
performance_logger = logging.getLogger("uvicorn.error")
VAULT_CONFIGURATION_ERROR = "Project credential encryption key is not configured"
VAULT_USER_MESSAGE = "Credentials Vault is temporarily unavailable. Please contact your administrator."
CLOSED_PERIOD_MARKER = "Accounting period is closed for date"
CLOSED_PERIOD_USER_MESSAGE = "This accounting period is closed. Reopen it with an audit reason before changing financial records."
SLOW_REQUEST_MS = 750.0
HIGH_QUERY_COUNT = 50
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _request_id(header_value: str | None) -> str:
    if header_value and REQUEST_ID_PATTERN.fullmatch(header_value):
        return header_value
    return str(uuid4())


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
async def request_observability(request: Request, call_next):
    request_id = _request_id(request.headers.get("x-request-id"))
    request.state.request_id = request_id
    metrics, metrics_token = start_request_metrics()
    started_at = perf_counter()
    response = None
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        total_ms = (perf_counter() - started_at) * 1000
        breakdown = build_request_performance_breakdown(metrics, total_ms)
        db_ms = breakdown.database_ms
        query_count = metrics.db_query_count
        slowest_query = metrics.db_slowest_query
        finish_request_metrics(metrics_token)

        if response is not None:
            response.headers["X-Request-ID"] = request_id
            if settings.environment.lower().strip() != "production":
                response.headers["Server-Timing"] = (
                    f'app;dur={total_ms:.2f}, '
                    f'db;dur={db_ms:.2f}, '
                    f'auth;dur={breakdown.authentication_ms:.2f}, '
                    f'tenant;dur={breakdown.tenant_resolution_ms:.2f}, '
                    f'permission;dur={breakdown.permission_ms:.2f}, '
                    f'other;dur={breakdown.application_other_ms:.2f}'
                )
                response.headers["X-Performance-Total-Ms"] = f"{total_ms:.2f}"
                response.headers["X-Performance-DB-Ms"] = f"{db_ms:.2f}"
                response.headers["X-Performance-DB-Queries"] = str(query_count)
                response.headers["X-Performance-DB-Max-Query-Ms"] = f"{metrics.db_max_query_ms:.2f}"
                response.headers["X-Performance-DB-Slow-Queries"] = str(metrics.db_slow_query_count)
                response.headers["X-Performance-Auth-Ms"] = f"{breakdown.authentication_ms:.2f}"
                response.headers["X-Performance-Tenant-Ms"] = f"{breakdown.tenant_resolution_ms:.2f}"
                response.headers["X-Performance-Permission-Ms"] = f"{breakdown.permission_ms:.2f}"
                response.headers["X-Performance-Application-Other-Ms"] = f"{breakdown.application_other_ms:.2f}"
                response.headers["X-Performance-Root-Cause"] = breakdown.root_cause
                response.headers["X-Performance-Root-Cause-Pct"] = f"{breakdown.root_cause_pct:.1f}"

        is_slow = (
            total_ms >= SLOW_REQUEST_MS
            or query_count >= HIGH_QUERY_COUNT
            or metrics.db_slow_query_count > 0
        )
        log = performance_logger.warning if is_slow else performance_logger.info
        log(
            "request.performance method=%s path=%s status=%s total_ms=%.2f "
            "root_cause=%s root_cause_ms=%.2f root_cause_pct=%.1f "
            "db_ms=%.2f db_queries=%s db_max_query_ms=%.2f db_slow_queries=%s "
            "db_slowest_fingerprint=%s db_slowest_operation=%s db_slowest_tables=%s db_slowest_source=%s "
            "auth_ms=%.2f tenant_ms=%.2f permission_ms=%.2f application_other_ms=%.2f "
            "request_id=%s",
            request.method,
            request.url.path,
            status_code,
            total_ms,
            breakdown.root_cause,
            breakdown.root_cause_ms,
            breakdown.root_cause_pct,
            db_ms,
            query_count,
            metrics.db_max_query_ms,
            metrics.db_slow_query_count,
            slowest_query.fingerprint if slowest_query else "-",
            slowest_query.operation if slowest_query else "-",
            ",".join(slowest_query.tables) if slowest_query and slowest_query.tables else "-",
            slowest_query.source if slowest_query else "-",
            breakdown.authentication_ms,
            breakdown.tenant_resolution_ms,
            breakdown.permission_ms,
            breakdown.application_other_ms,
            request_id,
        )


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
