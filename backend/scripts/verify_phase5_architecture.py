from __future__ import annotations

from pathlib import Path

from fastapi.routing import APIRoute

from app.main import _request_id, app


ROOT = Path(__file__).resolve().parents[2]
API_PREFIX = "/api/v1"


def main() -> None:
    public_overview_path = f"{API_PREFIX}/reports/overview"
    overview_routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path == public_overview_path
        and "GET" in (route.methods or set())
    ]
    if len(overview_routes) != 1:
        raise AssertionError(f"reports overview must have exactly one public owner, got {len(overview_routes)}")
    if overview_routes[0].name != "reports_overview_fast":
        raise AssertionError(f"reports overview is not owned by fast handler: {overview_routes[0].name}")

    operation = app.openapi()["paths"][public_overview_path]["get"]
    operation_id = str(operation.get("operationId") or "")
    if "reports_overview_fast" not in operation_id:
        raise AssertionError(f"OpenAPI reports overview owner regression: {operation_id}")

    valid_request_id = "trace-ABC_123:xyz"
    if _request_id(valid_request_id) != valid_request_id:
        raise AssertionError("valid request ID was not preserved")
    for invalid_request_id in ("", " bad", "bad value", "x" * 129, "bad\nvalue"):
        generated = _request_id(invalid_request_id)
        if generated == invalid_request_id or len(generated) != 36:
            raise AssertionError(f"unsafe request ID was not replaced: {invalid_request_id!r}")

    dockerfile = (ROOT / "backend/Dockerfile").read_text()
    if "alembic upgrade head &&" in dockerfile:
        raise AssertionError("backend runtime must not own schema migration")
    if "exec uv run --no-sync uvicorn" not in dockerfile:
        raise AssertionError("backend runtime must exec uvicorn for signal-safe shutdown")
    if "--workers ${WEB_CONCURRENCY:-1}" not in dockerfile:
        raise AssertionError("backend worker concurrency must be explicit and environment-controlled")

    production_compose = (ROOT / "deployment/docker-compose.yml").read_text()
    if production_compose.count("ENVIRONMENT: production") < 2:
        raise AssertionError("backend and finance scheduler must run with production environment semantics")
    if "alembic upgrade head" in production_compose:
        raise AssertionError("long-running production services must not run migrations")
    if production_compose.count("image: codestation-business-os-backend:latest") < 2:
        raise AssertionError("backend and finance scheduler must share the deployed backend image")
    if "name: codestation-business-os_business_os_uploads" not in production_compose:
        raise AssertionError("persistent upload volume name must remain stable across deployment paths")

    safe_deploy = (ROOT / "deployment/safe-deploy.sh").read_text()
    required_safe_deploy_fragments = (
        'UPLOADS_VOLUME="${PROJECT_NAME}_business_os_uploads"',
        '-v "${UPLOADS_VOLUME}:/data/uploads"',
        'verify-production.sh" --config-only',
        'Refreshing singleton finance scheduler from candidate backend image',
        'restore_previous_scheduler',
    )
    for fragment in required_safe_deploy_fragments:
        if fragment not in safe_deploy:
            raise AssertionError(f"safe deployment hardening missing: {fragment}")

    nginx = (ROOT / "deployment/nginx/codestation-business-os.conf").read_text()
    if "map $http_upgrade $business_os_connection_upgrade" not in nginx:
        raise AssertionError("Nginx keepalive/WebSocket map is missing")
    if 'Connection "upgrade"' in nginx:
        raise AssertionError("Nginx must not force Connection: upgrade for normal HTTP requests")
    if nginx.count("Connection $business_os_connection_upgrade") != 4:
        raise AssertionError("conditional Connection header must be applied to all four proxy locations")

    env_example = (ROOT / ".env.staging.example").read_text()
    if "WEB_CONCURRENCY=1" not in env_example:
        raise AssertionError("safe default web concurrency is not documented")

    print(
        "Phase 5 architecture verification passed: route ownership, request IDs, "
        "migration ownership, persistent uploads, scheduler rollout, Nginx keepalive"
    )


if __name__ == "__main__":
    main()
