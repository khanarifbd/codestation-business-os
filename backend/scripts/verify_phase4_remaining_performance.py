from __future__ import annotations

from dataclasses import dataclass

from fastapi.routing import APIRoute
from sqlalchemy import event, select

from app.api.v1.capital import meta as legacy_capital_meta
from app.api.v1.capital_insights import insights as legacy_capital_insights
from app.api.v1.client_portal import list_client_portal_orders as legacy_client_orders
from app.api.v1.finance_expenses import expense_meta as legacy_expense_meta
from app.api.v1.hr import hr_dashboard as legacy_hr_dashboard, hr_meta as legacy_hr_meta
from app.api.v1.hr_workspace import hr_access as legacy_hr_access, hr_workspace_summary as legacy_hr_workspace_summary
from app.api.v1.phase4_read_fast_extra import (
    capital_insights_fast,
    capital_meta_fast,
    hr_access_fast,
    hr_dashboard_fast,
    hr_meta_fast,
    list_client_portal_orders_fast,
    router as phase4_extra_router,
)
from app.api.v1.phase4_remaining_fast import (
    expense_meta_lite,
    hr_workspace_summary_fast,
    router as phase4_remaining_router,
)
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.client_access import ClientMembership
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import OrganizationRole
from app.models.user import User
from app.tenancy.context import TenantContext


API_PREFIX = "/api/v1"


@dataclass(frozen=True)
class TenantStub:
    organization_id: str


def count_selects(fn):
    count = 0

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        if statement.lstrip().upper().startswith("SELECT"):
            count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    return result, count


def tenant_context(db, membership: Membership) -> TenantContext:
    organization = db.get(Organization, membership.organization_id)
    user = db.get(User, membership.user_id)
    role = db.get(OrganizationRole, membership.role_id) if membership.role_id else None
    if organization is None or user is None:
        raise AssertionError("tenant fixture is missing organization or user")
    return TenantContext(
        user=user,
        organization=organization,
        membership=membership,
        organization_role=role,
    )


def privileged_tenant(db) -> TenantContext:
    memberships = db.scalars(select(Membership).where(Membership.status == "active")).all()
    for membership in memberships:
        role = db.get(OrganizationRole, membership.role_id) if membership.role_id else None
        permissions = set(role.permissions or []) if role and role.is_active else set()
        if "*" in permissions or {"capital.view", "hr.view"}.issubset(permissions):
            return tenant_context(db, membership)
    raise AssertionError("no active tenant member with capital.view and hr.view found")


def client_portal_tenant(db) -> TenantContext:
    access_rows = db.scalars(select(ClientMembership).where(ClientMembership.status == "active")).all()
    for access in access_rows:
        membership = db.get(Membership, access.membership_id)
        if membership is not None and membership.status == "active" and membership.organization_id == access.organization_id:
            return tenant_context(db, membership)
    raise AssertionError("no active client portal membership found")


def route_endpoint(source_router, method: str, path: str):
    matches = [
        route
        for route in source_router.routes
        if isinstance(route, APIRoute) and route.path == path and method in (route.methods or set())
    ]
    if len(matches) != 1:
        raise AssertionError(f"expected one Phase 4 source {method} {path}, found {len(matches)}")
    return matches[0].endpoint


def main() -> None:
    db = SessionLocal()
    try:
        tenant = privileged_tenant(db)
        portal_tenant = client_portal_tenant(db)

        legacy_orders = legacy_client_orders(db, portal_tenant)
        fast_orders, portal_queries = count_selects(lambda: list_client_portal_orders_fast(db, portal_tenant))
        if [item.model_dump() for item in legacy_orders] != [item.model_dump() for item in fast_orders]:
            raise AssertionError("batched client portal orders changed API output")
        if portal_queries > 2:
            raise AssertionError(f"client portal order query regression: expected <=2 SELECTs, got {portal_queries}")

        legacy_meta = legacy_capital_meta(db, tenant)
        fast_meta, capital_meta_queries = count_selects(lambda: capital_meta_fast(db, tenant))
        if legacy_meta != fast_meta:
            raise AssertionError("batched capital meta changed API output")
        if capital_meta_queries > 2:
            raise AssertionError(f"capital meta query regression: expected <=2 SELECTs, got {capital_meta_queries}")

        legacy_insights = legacy_capital_insights(db, tenant)
        fast_insights, capital_insight_queries = count_selects(lambda: capital_insights_fast(db, tenant))
        if legacy_insights != fast_insights:
            raise AssertionError("batched capital insights changed API output")
        if capital_insight_queries > 10:
            raise AssertionError(
                f"capital insights query regression: expected <=10 SELECTs, got {capital_insight_queries}"
            )

        legacy_dashboard = legacy_hr_dashboard(db, tenant)
        fast_dashboard, hr_dashboard_queries = count_selects(lambda: hr_dashboard_fast(db, tenant))
        if legacy_dashboard != fast_dashboard:
            raise AssertionError("batched HR dashboard changed API output")
        if hr_dashboard_queries != 1:
            raise AssertionError(f"HR dashboard query regression: expected 1 SELECT, got {hr_dashboard_queries}")

        legacy_meta_hr = legacy_hr_meta(db, tenant)
        fast_meta_hr, hr_meta_queries = count_selects(lambda: hr_meta_fast(db, tenant))
        if legacy_meta_hr != fast_meta_hr:
            raise AssertionError("batched HR meta changed API output")
        if hr_meta_queries > 4:
            raise AssertionError(f"HR meta query regression: expected <=4 SELECTs, got {hr_meta_queries}")

        legacy_access = legacy_hr_access(db, tenant)
        fast_access, hr_access_queries = count_selects(lambda: hr_access_fast(db, tenant))
        if legacy_access != fast_access:
            raise AssertionError("batched HR access changed API output")
        if hr_access_queries > 1:
            raise AssertionError(f"HR access query regression: expected <=1 SELECT, got {hr_access_queries}")

        legacy_workspace = legacy_hr_workspace_summary(db, tenant)
        fast_workspace, hr_workspace_queries = count_selects(lambda: hr_workspace_summary_fast(db, tenant))
        if legacy_workspace != fast_workspace:
            raise AssertionError("batched HR workspace summary changed API output")
        if hr_workspace_queries > 1:
            raise AssertionError(
                f"HR workspace summary query regression: expected <=1 SELECT, got {hr_workspace_queries}"
            )

        full_expense_meta = legacy_expense_meta(db, tenant)
        lite_expense_meta, expense_meta_queries = count_selects(lambda: expense_meta_lite(db, tenant))
        if full_expense_meta.vendors != lite_expense_meta.vendors:
            raise AssertionError("expense meta lite changed vendor metadata")
        if full_expense_meta.categories != lite_expense_meta.categories:
            raise AssertionError("expense meta lite changed category metadata")
        if full_expense_meta.accounts != lite_expense_meta.accounts:
            raise AssertionError("expense meta lite changed financial account metadata")
        if any(
            (
                lite_expense_meta.clients,
                lite_expense_meta.projects,
                lite_expense_meta.orders,
                lite_expense_meta.invoices,
                lite_expense_meta.payments,
            )
        ):
            raise AssertionError("expense meta lite must not eagerly load relationship catalogs")
        if expense_meta_queries > 4:
            raise AssertionError(f"expense meta lite query regression: expected <=4 SELECTs, got {expense_meta_queries}")

        source_operations = (
            (phase4_extra_router, "GET", "/client-portal/orders", "list_client_portal_orders_fast"),
            (phase4_extra_router, "GET", "/capital/meta", "capital_meta_fast"),
            (phase4_extra_router, "GET", "/capital/insights", "capital_insights_fast"),
            (phase4_extra_router, "GET", "/hr/access", "hr_access_fast"),
            (phase4_extra_router, "GET", "/hr/dashboard", "hr_dashboard_fast"),
            (phase4_extra_router, "GET", "/hr/meta", "hr_meta_fast"),
            (phase4_remaining_router, "GET", "/hr/workspace-summary", "hr_workspace_summary_fast"),
            (phase4_remaining_router, "GET", "/finance/expense-meta-lite", "expense_meta_lite"),
        )
        schema_paths = app.openapi().get("paths", {})
        for source_router, method, path, expected_name in source_operations:
            endpoint = route_endpoint(source_router, method, path)
            if endpoint.__name__ != expected_name:
                raise AssertionError(f"{method} {path} is not owned by the Phase 4 bounded handler")
            public_path = f"{API_PREFIX}{path}"
            if public_path not in schema_paths or method.lower() not in schema_paths[public_path]:
                raise AssertionError(f"public OpenAPI operation is missing: {method} {public_path}")
    finally:
        db.close()

    print(
        "Phase 4 remaining performance verification passed: "
        f"portal_orders={portal_queries}, capital_meta={capital_meta_queries}, "
        f"capital_insights={capital_insight_queries}, hr_dashboard={hr_dashboard_queries}, "
        f"hr_meta={hr_meta_queries}, hr_access={hr_access_queries}, "
        f"hr_workspace={hr_workspace_queries}, expense_meta_lite={expense_meta_queries}"
    )


if __name__ == "__main__":
    main()
