from __future__ import annotations

from collections import Counter

from fastapi.routing import APIRoute

from app.main import app


CRITICAL_SINGLETON_OPERATIONS = {
    ("POST", "/api/v1/finance/accounts"),
    ("PATCH", "/api/v1/finance/invoices/{invoice_id}/status"),
    ("POST", "/api/v1/finance/payments"),
    ("POST", "/api/v1/finance/expenses"),
    ("POST", "/api/v1/finance/expenses/{expense_id}/void"),
    ("POST", "/api/v1/finance/transfers"),
    ("POST", "/api/v1/accounting/payables/{bill_id}/payments"),
    ("POST", "/api/v1/accounting/loans/{loan_id}/disburse"),
    ("POST", "/api/v1/accounting/loans/{loan_id}/repay"),
}

TYPED_OPERATIONS = {
    ("GET", "/api/v1/accounting/loans"),
    ("POST", "/api/v1/accounting/loans"),
    ("POST", "/api/v1/accounting/loans/{loan_id}/approve"),
    ("POST", "/api/v1/accounting/loans/{loan_id}/disburse"),
    ("POST", "/api/v1/accounting/loans/{loan_id}/repay"),
    ("POST", "/api/v1/accounting/loans/{loan_id}/close"),
    ("GET", "/api/v1/accounting/loans/{loan_id}/schedule"),
    ("PUT", "/api/v1/accounting/loans/{loan_id}/schedule"),
    ("GET", "/api/v1/accounting/loans/{loan_id}/history"),
    ("GET", "/api/v1/accounting/assets/meta"),
    ("GET", "/api/v1/accounting/assets"),
    ("GET", "/api/v1/accounting/assets/summary"),
    ("POST", "/api/v1/accounting/assets"),
    ("POST", "/api/v1/accounting/assets/depreciation"),
    ("GET", "/api/v1/accounting/assets/{asset_id}/depreciation"),
    ("GET", "/api/v1/accounting/reconciliations/meta"),
    ("GET", "/api/v1/accounting/reconciliations"),
    ("POST", "/api/v1/accounting/reconciliations"),
    ("GET", "/api/v1/accounting/reconciliations/{reconciliation_id}"),
    ("POST", "/api/v1/accounting/reconciliations/{reconciliation_id}/transactions/{transaction_id}"),
    ("POST", "/api/v1/accounting/reconciliations/{reconciliation_id}/finalize"),
}


def main() -> None:
    routes: dict[tuple[str, str], list[APIRoute]] = {}
    counts: Counter[tuple[str, str]] = Counter()
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            key = (method, route.path)
            counts[key] += 1
            routes.setdefault(key, []).append(route)

    for key in sorted(CRITICAL_SINGLETON_OPERATIONS):
        if counts[key] != 1:
            raise AssertionError(f"critical financial operation must be registered exactly once: {key}, count={counts[key]}")

    missing = [key for key in sorted(TYPED_OPERATIONS) if counts[key] != 1]
    if missing:
        raise AssertionError(f"missing or duplicated typed accounting operations: {missing}")
    untyped = [key for key in sorted(TYPED_OPERATIONS) if routes[key][0].response_model is None]
    if untyped:
        raise AssertionError(f"public accounting operations are missing response models: {untyped}")

    schema = app.openapi()
    reconciliation_schema = schema.get("components", {}).get("schemas", {}).get("ReconciliationCreate")
    if not reconciliation_schema:
        raise AssertionError("ReconciliationCreate is missing from OpenAPI")
    properties = reconciliation_schema.get("properties", {})
    for field in ("statement_start_date", "statement_end_date"):
        definition = properties.get(field)
        if not definition:
            raise AssertionError(f"{field} missing from ReconciliationCreate OpenAPI schema")
        # Optional dates may be represented as anyOf[date, null].
        candidates = definition.get("anyOf", [definition])
        if not any(item.get("type") == "string" and item.get("format") == "date" for item in candidates):
            raise AssertionError(f"{field} is not exposed as an OpenAPI date: {definition}")

    print("accounting API hardening verification passed: unique financial routes, typed contracts, strict reconciliation dates")


if __name__ == "__main__":
    main()
