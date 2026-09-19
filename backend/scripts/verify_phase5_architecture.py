from __future__ import annotations

from pathlib import Path

from app.main import _request_id, app


ROOT = Path(__file__).resolve().parents[2]
API_PREFIX = "/api/v1"


def _require_fragment(source: str, fragment: str, message: str) -> None:
    if fragment not in source:
        raise AssertionError(message)


def main() -> None:
    # Public ownership is verified through the actual application contract. The
    # router module also runs _assert_unique_operations(api_router) at import
    # time, so duplicate method/path registrations fail before the app starts.
    public_overview_path = f"{API_PREFIX}/reports/overview"
    operation = app.openapi().get("paths", {}).get(public_overview_path, {}).get("get")
    if operation is None:
        raise AssertionError("public reports overview operation is missing")
    operation_id = str(operation.get("operationId") or "")
    if "reports_overview_fast" not in operation_id:
        raise AssertionError(f"OpenAPI reports overview owner regression: {operation_id}")

    router_source = (ROOT / "backend/app/api/v1/router.py").read_text()
    for fragment in (
        '("GET", "/reports/overview")',
        "_remove_shadowed_report_read_routes(reports_router)",
        "_assert_unique_operations(api_router)",
    ):
        _require_fragment(
            router_source,
            fragment,
            f"reports overview ownership/uniqueness contract is missing: {fragment}",
        )

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
    if "image: codestation-business-os-frontend:latest" not in production_compose:
        raise AssertionError("frontend image tag must remain stable across legacy and canonical Compose project names")
    if "name: codestation-business-os_business_os_uploads" not in production_compose:
        raise AssertionError("persistent upload volume name must remain stable across deployment paths")

    deploy = (ROOT / "deployment/deploy.sh").read_text()
    required_deploy_fragments = (
        'UPLOADS_VOLUME="codestation-business-os_business_os_uploads"',
        'resolve_compose_project() {',
        'Multiple Business OS PostgreSQL Compose projects were found',
        'Preserving existing PostgreSQL Compose project',
        'Deployment code changed to ${after_update}; re-executing the canonical script',
        'BUSINESS_OS_DEPLOY_REEXEC',
        '-v "${UPLOADS_VOLUME}:/data/uploads"',
        'verify-production.sh" --config-only',
        'Refreshing singleton finance scheduler from candidate backend image',
        'restore_previous_scheduler',
        'sync_active_uploads_to_volume() {',
        'docker cp "${source_container}:/data/uploads/." "${helper_name}:/data/uploads/"',
        'sync_active_uploads_to_volume "${active_slot}"',
    )
    for fragment in required_deploy_fragments:
        if fragment not in deploy:
            raise AssertionError(f"canonical deployment hardening missing: {fragment}")

    for deprecated_entrypoint in (
        ROOT / "deployment/safe-deploy.sh",
        ROOT / "infrastructure/deploy-staging.sh",
    ):
        if deprecated_entrypoint.exists():
            raise AssertionError(f"duplicate deployment entrypoint must not return: {deprecated_entrypoint}")

    sync_call = deploy.index('sync_active_uploads_to_volume "${active_slot}"')
    inactive_removal = deploy.index('remove_legacy_blue_if_inactive "${active_slot}"')
    if sync_call >= inactive_removal:
        raise AssertionError("active uploads must be preserved before any legacy active data can be removed")

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
        "migration ownership, single deployment entrypoint, database project preservation, "
        "persistent/legacy uploads, scheduler rollout, Nginx keepalive"
    )


if __name__ == "__main__":
    main()
