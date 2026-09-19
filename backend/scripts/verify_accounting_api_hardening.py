from __future__ import annotations

from collections import Counter

from fastapi.routing import APIRoute

# Import the canonical application first so source routers have already gone
# through the same shadow-route removal and public assembly used by Uvicorn.
from app.main import app
from app.api.v1.accounting_assets import router as accounting_assets_router
from app.api.v1.accounting_loan_details import router as accounting_loan_details_router
from app.api.v1.accounting_loans import router as accounting_loans_router
from app.api.v1.accounting_money import router as accounting_money_router
from app.api.v1.accounting_read_fast import router as accounting_read_fast_router
from app.api.v1.accounting_read_fast_extra import router as accounting_read_fast_extra_router
from app.api.v1.accounting_reconciliation import router as accounting_reconciliation_router
from app.api.v1.customer_advances import router as customer_advances_router
from app.api.v1.finance import router as finance_router
from app.api.v1.finance_expenses import router as finance_expenses_router
from app.api.v1.finance_transfers import router as finance_transfers_router
from app.api.v1.financial_safety import router as financial_safety_router
from app.api.v1.payables import router as payables_router


API_PREFIX = "/api/v1"

CRITICAL_SINGLETON_OPERATIONS = {
    ("POST", "/finance/accounts"),
    ("POST", "/accounting/money"),
    ("POST", "/accounting/customer-advances"),
    ("POST", "/accounting/customer-advances/{advance_id}/apply"),
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

LEGACY_FINANCIAL_ROUTERS = (
    finance_router,
    accounting_money_router,
    customer_advances_router,
    finance_expenses_router,
    finance_transfers_router,
    payables_router,
    accounting_loans_router,
)

ACCOUNTING_CONTRACT_ROUTERS = (
    financial_safety_router,
    accounting_loans_router,
    accounting_loan_details_router,
    accounting_assets_router,
    accounting_read_fast_router,
    accounting_read_fast_extra_router,
    accounting_reconciliation_router,
)


def _index_routers(routers) -> tuple[Counter[tuple[str, str]], dict[tuple[str, str], list[APIRoute]]]:
    counts: Counter[tuple[str, str]] = Counter()
    indexed: dict[tuple[str, str], list[APIRoute]] = {}
    for router in routers:
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in route.methods or set():
                if method in {"HEAD", "OPTIONS"}:
                    continue
                key = (method, route.path)
                counts[key] += 1
                indexed.setdefault(key, []).append(route)
    return counts, indexed


def _route_rows(router) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods or set()):
            if method not in {"HEAD", "OPTIONS"}:
                rows.append((method, route.path, route.endpoint.__module__))
    return rows


def main() -> None:
    safety_counts, safety_routes = _index_routers((financial_safety_router,))
    legacy_counts, _ = _index_routers(LEGACY_FINANCIAL_ROUTERS)

    # Critical financial mutations must live exactly once in the safety router,
    # and the original business routers must no longer expose shadow copies.
    for key in sorted(CRITICAL_SINGLETON_OPERATIONS):
        if safety_counts[key] != 1:
            raise AssertionError(
                f"critical financial operation missing/duplicated in safety router: {key}, "
                f"count={safety_counts[key]}, routes={_route_rows(financial_safety_router)}"
            )
        route = safety_routes[key][0]
        if route.endpoint.__module__ != "app.api.v1.financial_safety":
            raise AssertionError(
                f"critical financial operation bypasses financial safety wrapper: {key}, "
                f"endpoint={route.endpoint.__module__}"
            )
        if legacy_counts[key] != 0:
            raise AssertionError(
                f"legacy financial router still exposes protected operation: {key}, "
                f"legacy_count={legacy_counts[key]}"
            )

    contract_counts, contract_routes = _index_routers(ACCOUNTING_CONTRACT_ROUTERS)
    missing = []
    untyped = []
    for key in sorted(TYPED_OPERATIONS):
        if contract_counts[key] != 1:
            missing.append((key, contract_counts[key]))
            continue
        if contract_routes[key][0].response_model is None:
            untyped.append(key)
    if missing:
        raise AssertionError(f"missing or duplicated typed accounting operations: {missing}")
    if untyped:
        raise AssertionError(f"public accounting operations are missing response models: {untyped}")

    # Public exposure is verified from FastAPI's generated contract rather than
    # relying on the internal representation of nested include_router() routes.
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
        "accounting API hardening verification passed: safety ownership, legacy shadow removal, "
        "typed contracts across canonical read/write routers, public OpenAPI coverage, strict reconciliation dates"
    )


if __name__ == "__main__":
    main()
