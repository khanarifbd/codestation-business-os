from __future__ import annotations

from collections import Counter

from fastapi.routing import APIRoute

from app.main import app


API_PREFIX = "/api/v1"

CRITICAL_SINGLETON_OPERATIONS = {
    ("POST", "/finance/accounts"),
    ("PATCH", "/finance/invoices/{invoice_id}/status"),
    ("POST", "/finance/payments"),
    ("POST", "/finance/expenses"),
    ("POST", "/finance/expenses/{expense_id}/void"),
    ("POST", "/finance/transfers"),
    ("POST", "/accounting/payables/{bill_id}/payments"),
    ("POST", "/accounting/loans/{loan_id}/disburse"),
    ("POST", "/accounting/loans/{loan_id}/repay"),
}

TYPED_OPERATIONS = {
    ("GET", "/accounting/loans"),
    ("POST", "/accounting/loans"),
    ("POST", "/accounting/loans/{loan_id}/approve"),
    ("POST", "/accounting/loans/{loan_id}/disburse"),
    ("POST", "/accounting/loans/{loan_id}/repay"),
    ("POST", "/accounting/loans/{loan_id}/close"),
    ("GET", "/accounting/loans/{loan_id}/schedule"),
    ("PUT", "/accounting/loans/{loan_id}/schedule"),
    ("GET", "/accounting/loans/{loan_id}/history"),
    ("GET", "/accounting/assets/meta"),
    ("GET", "/accounting/assets"),
    ("GET", "/accounting/assets/summary"),
    ("POST", "/accounting/assets"),
    ("POST", "/accounting/assets/depreciation"),
    ("GET", "/accounting/assets/{asset_id}/depreciation"),
    ("GET", "/accounting/reconciliations/meta"),
    ("GET", "/accounting/reconciliations"),
    ("POST", "/accounting/reconciliations"),
    ("GET", "/accounting/reconciliations/{reconciliation_id}"),
    ("POST", "/accounting/reconciliations/{reconciliation_id}/transactions/{transaction_id}"),
    ("POST", "/accounting/reconciliations/{reconciliation_id}/finalize"),
}


def _public_key(operation: tuple[str, str]) -> tuple[str, str]:
    method, path = operation
    return method, f"{API_PREFIX}{path}"


def _route_index() -> tuple[Counter[tuple[str, str]], dict[tuple[str, str], list[APIRoute]]]:
    counts: Counter[tuple[str, str]] = Counter()
    routes: dict[tuple[str, str], list[APIRoute]] = {}
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            key = (method, route.path)
            counts[key] += 1
            routes.setdefault(key, []).append(route)
    return counts, routes


def main() -> None:
    counts, routes = _route_index()

    for operation in sorted(CRITICAL_SINGLETON_OPERATIONS):
        key = _public_key(operation)
        if counts[key] != 1:
            raise AssertionError(
                f"critical financial operation must be registered exactly once on the public API: {key}, count={counts[key]}"
            )
        endpoint_module = routes[key][0].endpoint.__module__
        if endpoint_module != "app.api.v1.financial_safety":
            raise AssertionError(
                f"critical financial operation bypasses financial safety wrapper: {key}, endpoint={endpoint_module}"
            )

    missing = []
    untyped = []
    for operation in sorted(TYPED_OPERATIONS):
        key = _public_key(operation)
        if counts[key] != 1:
            missing.append((key, counts[key]))
            continue
        if routes[key][0].response_model is None:
            untyped.append(key)
    if missing:
        raise AssertionError(f"missing or duplicated typed accounting operations: {missing}")
    if untyped:
        raise AssertionError(f"public accounting operations are missing response models: {untyped}")

    schema = app.openapi()
    public_paths = schema.get("paths", {})
    for method, path in sorted(CRITICAL_SINGLETON_OPERATIONS | TYPED_OPERATIONS):
        public_path = f"{API_PREFIX}{path}"
        if public_path not in public_paths or method.lower() not in public_paths[public_path]:
            raise AssertionError(f"public OpenAPI operation is missing: {method} {public_path}")

    reconciliation_schema = schema.get("components", {}).get("schemas", {}).get("ReconciliationCreate")
    if not reconciliation_schema:
        raise AssertionError("ReconciliationCreate is missing from OpenAPI")
    properties = reconciliation_schema.get("properties", {})
    for field in ("statement_start_date", "statement_end_date"):
        definition = properties.get(field)
        if not definition:
            raise AssertionError(f"{field} missing from ReconciliationCreate OpenAPI schema")
        candidates = definition.get("anyOf", [definition])
        if not any(item.get("type") == "string" and item.get("format") == "date" for item in candidates):
            raise AssertionError(f"{field} is not exposed as an OpenAPI date: {definition}")

    print(
        "accounting API hardening verification passed: singleton public safety routes, "
        "typed contracts, OpenAPI coverage, strict reconciliation dates"
    )


if __name__ == "__main__":
    main()
