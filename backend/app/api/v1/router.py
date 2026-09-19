from fastapi import APIRouter
from fastapi.routing import APIRoute

from app.api.v1.accounting import router as accounting_router
from app.api.v1.accounting_accounts import router as accounting_accounts_router
from app.api.v1.accounting_assets import router as accounting_assets_router
from app.api.v1.accounting_loan_details import router as accounting_loan_details_router
from app.api.v1.accounting_loans import router as accounting_loans_router
from app.api.v1.accounting_money import router as accounting_money_router
from app.api.v1.accounting_read_fast import router as accounting_read_fast_router
from app.api.v1.accounting_read_fast_extra import router as accounting_read_fast_extra_router
from app.api.v1.accounting_reconciliation import router as accounting_reconciliation_router
from app.api.v1.accounting_reports import router as accounting_reports_router
from app.api.v1.accounting_sync import router as accounting_sync_router
from app.api.v1.activity_logs import platform_activity_router, tenant_activity_router
from app.api.v1.auth import router as auth_router
from app.api.v1.capital import router as capital_router
from app.api.v1.capital_insights import router as capital_insights_router
from app.api.v1.client_access import router as client_access_router
from app.api.v1.client_external_profiles import router as client_external_profiles_router
from app.api.v1.client_invitations import public_router as client_invitation_public_router, router as client_invitation_router
from app.api.v1.client_portal import router as client_portal_router
from app.api.v1.client_resources import router as client_resources_router
from app.api.v1.company_currencies import router as company_currencies_router
from app.api.v1.company_defaults import router as company_defaults_router
from app.api.v1.company_settings import router as company_settings_router
from app.api.v1.company_uploads import router as company_uploads_router
from app.api.v1.crm import router as crm_router
from app.api.v1.crm_clients import router as crm_clients_router
from app.api.v1.crm_client_workspace import router as crm_client_workspace_router
from app.api.v1.crm_interests import router as crm_interests_router
from app.api.v1.crm_status import router as crm_status_router
from app.api.v1.crm_summary import router as crm_summary_router
from app.api.v1.customer_advances import router as customer_advances_router
from app.api.v1.dashboard_pulse import router as dashboard_pulse_router
from app.api.v1.employee_invitations import router as employee_invitations_router
from app.api.v1.exchange_rates import router as exchange_rates_router
from app.api.v1.finance import router as finance_router
from app.api.v1.finance_auto_post import router as finance_auto_post_router
from app.api.v1.finance_controls import router as finance_controls_router
from app.api.v1.finance_expenses import router as finance_expenses_router
from app.api.v1.finance_invoice_drafts import router as finance_invoice_drafts_router
from app.api.v1.finance_invoice_payments import router as finance_invoice_payments_router
from app.api.v1.finance_pagination import router as finance_pagination_router
from app.api.v1.finance_transfers import router as finance_transfers_router
from app.api.v1.financial_correction_history import router as financial_correction_history_router
from app.api.v1.financial_corrections import router as financial_corrections_router
from app.api.v1.financial_safety import router as financial_safety_router
from app.api.v1.health import router as health_router
from app.api.v1.hr import router as hr_router
from app.api.v1.hr_extended import router as hr_extended_router
from app.api.v1.hr_self import router as hr_self_router
from app.api.v1.hr_uploads import router as hr_uploads_router
from app.api.v1.hr_workspace import router as hr_workspace_router
from app.api.v1.inventory import router as inventory_router
from app.api.v1.inventory_fulfillment import router as inventory_fulfillment_router
from app.api.v1.inventory_management import router as inventory_management_router
from app.api.v1.inventory_workflows import router as inventory_workflows_router
from app.api.v1.manual_orders import router as manual_orders_router
from app.api.v1.order_commercial import router as order_commercial_router
from app.api.v1.order_links import router as order_links_router
from app.api.v1.order_settlements import router as order_settlements_router
from app.api.v1.orders import router as orders_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.payables import router as payables_router
from app.api.v1.payroll import router as payroll_router
from app.api.v1.phase4_read_fast import router as phase4_read_fast_router
from app.api.v1.phase4_read_fast_extra import router as phase4_read_fast_extra_router
from app.api.v1.phase4_remaining_fast import router as phase4_remaining_fast_router
from app.api.v1.platform import router as platform_router
from app.api.v1.platform_organization_detail import router as platform_organization_detail_router
from app.api.v1.profile import router as profile_router
from app.api.v1.profile_identity import router as profile_identity_router
from app.api.v1.profile_sessions import router as profile_sessions_router
from app.api.v1.project_client_sharing import router as project_client_sharing_router
from app.api.v1.project_documents import router as project_documents_router
from app.api.v1.project_execution import router as project_execution_router
from app.api.v1.project_feedback import router as project_feedback_router
from app.api.v1.project_notes import router as project_notes_router
from app.api.v1.projects import router as projects_router
from app.api.v1.quotation_v2 import router as quotation_v2_router
from app.api.v1.reports_fast import router as reports_fast_router
from app.api.v1.reports import router as reports_router
from app.api.v1.sales import router as sales_router
from app.api.v1.services import router as services_router
from app.api.v1.tax import router as tax_router
from app.api.v1.team import invitation_router, router as team_router
from app.api.v1.tenant import router as tenant_router
from app.api.v1.workspace import router as workspace_router


# These mutations are intentionally exposed only through financial_safety_router.
# The underlying endpoint functions remain importable business handlers, but their
# duplicate public routes are removed so route ordering can never bypass atomic
# posting, idempotency, or journal creation.
_SHADOWED_FINANCIAL_OPERATIONS = {
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


def _remove_shadowed_financial_routes(router: APIRouter) -> None:
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            isinstance(route, APIRoute)
            and any(
                (method, route.path) in _SHADOWED_FINANCIAL_OPERATIONS
                for method in (route.methods or set())
            )
        )
    ]


for _router in (
    finance_router,
    accounting_money_router,
    customer_advances_router,
    finance_expenses_router,
    finance_transfers_router,
    payables_router,
    accounting_loans_router,
):
    _remove_shadowed_financial_routes(_router)


# Expensive accounting reads keep their original business handlers importable for
# equivalence verification, while the public GET operations use bounded batched SQL.
_SHADOWED_ACCOUNTING_READ_OPERATIONS = {
    ("GET", "/accounting/money"),
    ("GET", "/accounting/reconciliations/meta"),
    ("GET", "/accounting/reconciliations"),
    ("GET", "/accounting/journals"),
    ("GET", "/accounting/customer-advances"),
    ("GET", "/accounting/payables"),
    ("GET", "/accounting/loans"),
    ("GET", "/accounting/tax/report"),
}


def _remove_shadowed_accounting_read_routes(router: APIRouter) -> None:
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            isinstance(route, APIRoute)
            and any(
                (method, route.path) in _SHADOWED_ACCOUNTING_READ_OPERATIONS
                for method in (route.methods or set())
            )
        )
    ]


for _router in (
    accounting_money_router,
    accounting_reconciliation_router,
    accounting_router,
    customer_advances_router,
    payables_router,
    accounting_loans_router,
    tax_router,
):
    _remove_shadowed_accounting_read_routes(_router)


# Phase 4 keeps the mature write handlers in place while replacing only read
# paths that have data-size-dependent N+1 growth or unnecessary repeated scans.
_SHADOWED_PHASE4_READ_OPERATIONS = {
    ("GET", "/inventory/products"),
    ("GET", "/inventory/suppliers"),
    ("GET", "/projects/{project_id}/workspace"),
    ("GET", "/crm/client-access"),
    ("GET", "/client-portal/orders"),
    ("GET", "/capital/meta"),
    ("GET", "/capital/insights"),
    ("GET", "/hr/access"),
    ("GET", "/hr/dashboard"),
    ("GET", "/hr/meta"),
    ("GET", "/hr/workspace-summary"),
}


def _remove_shadowed_phase4_read_routes(router: APIRouter) -> None:
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            isinstance(route, APIRoute)
            and any(
                (method, route.path) in _SHADOWED_PHASE4_READ_OPERATIONS
                for method in (route.methods or set())
            )
        )
    ]


for _router in (
    inventory_router,
    inventory_management_router,
    project_execution_router,
    client_access_router,
    client_portal_router,
    capital_router,
    capital_insights_router,
    hr_workspace_router,
    hr_router,
):
    _remove_shadowed_phase4_read_routes(_router)


# Reports keeps the legacy overview handler importable for equivalence tests while
# the bounded-query implementation is the only public owner of GET /reports/overview.
_SHADOWED_REPORT_READ_OPERATIONS = {
    ("GET", "/reports/overview"),
}


def _remove_shadowed_report_read_routes(router: APIRouter) -> None:
    router.routes[:] = [
        route
        for route in router.routes
        if not (
            isinstance(route, APIRoute)
            and any(
                (method, route.path) in _SHADOWED_REPORT_READ_OPERATIONS
                for method in (route.methods or set())
            )
        )
    ]


_remove_shadowed_report_read_routes(reports_router)


api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(profile_router)
api_router.include_router(profile_identity_router)
api_router.include_router(profile_sessions_router)
api_router.include_router(invitation_router)
api_router.include_router(client_invitation_public_router)
api_router.include_router(organizations_router)
api_router.include_router(tenant_router)
api_router.include_router(client_portal_router)
api_router.include_router(team_router)
api_router.include_router(employee_invitations_router)
api_router.include_router(hr_workspace_router)
api_router.include_router(hr_router)
api_router.include_router(hr_extended_router)
api_router.include_router(hr_self_router)
api_router.include_router(hr_uploads_router)
api_router.include_router(crm_summary_router)
api_router.include_router(crm_status_router)
api_router.include_router(crm_clients_router)
api_router.include_router(crm_client_workspace_router)
api_router.include_router(crm_interests_router)
api_router.include_router(client_access_router)
api_router.include_router(client_invitation_router)
api_router.include_router(client_external_profiles_router)
api_router.include_router(client_resources_router)
api_router.include_router(crm_router)
api_router.include_router(sales_router)
api_router.include_router(quotation_v2_router)
api_router.include_router(services_router)
api_router.include_router(manual_orders_router)
api_router.include_router(orders_router)
api_router.include_router(order_commercial_router)
api_router.include_router(inventory_fulfillment_router)
api_router.include_router(order_links_router)
api_router.include_router(phase4_read_fast_router)
api_router.include_router(phase4_read_fast_extra_router)
api_router.include_router(phase4_remaining_fast_router)
api_router.include_router(projects_router)
api_router.include_router(project_execution_router)
api_router.include_router(project_client_sharing_router)
api_router.include_router(project_feedback_router)
api_router.include_router(project_documents_router)
api_router.include_router(project_notes_router)
api_router.include_router(inventory_router)
api_router.include_router(inventory_management_router)
api_router.include_router(inventory_workflows_router)
api_router.include_router(financial_safety_router)
api_router.include_router(financial_corrections_router)
api_router.include_router(financial_correction_history_router)
api_router.include_router(accounting_read_fast_router)
api_router.include_router(accounting_read_fast_extra_router)
api_router.include_router(accounting_router)
api_router.include_router(accounting_accounts_router)
api_router.include_router(accounting_assets_router)
api_router.include_router(accounting_loans_router)
api_router.include_router(accounting_loan_details_router)
api_router.include_router(accounting_money_router)
api_router.include_router(accounting_reconciliation_router)
api_router.include_router(accounting_sync_router)
api_router.include_router(accounting_reports_router)
api_router.include_router(tax_router)
api_router.include_router(customer_advances_router)
api_router.include_router(payables_router)
api_router.include_router(finance_router)
api_router.include_router(order_settlements_router)
api_router.include_router(finance_invoice_drafts_router)
api_router.include_router(finance_invoice_payments_router)
api_router.include_router(finance_pagination_router)
api_router.include_router(finance_transfers_router)
api_router.include_router(finance_expenses_router)
api_router.include_router(finance_controls_router)
api_router.include_router(finance_auto_post_router)
api_router.include_router(payroll_router)
api_router.include_router(capital_router)
api_router.include_router(capital_insights_router)
api_router.include_router(reports_fast_router)
api_router.include_router(reports_router)
api_router.include_router(dashboard_pulse_router)
api_router.include_router(workspace_router)
api_router.include_router(company_uploads_router)
api_router.include_router(company_settings_router)
api_router.include_router(company_currencies_router)
api_router.include_router(company_defaults_router)
api_router.include_router(exchange_rates_router)
api_router.include_router(tenant_activity_router)
api_router.include_router(platform_router)
api_router.include_router(platform_organization_detail_router)
api_router.include_router(platform_activity_router)


def _assert_unique_operations(router: APIRouter) -> None:
    seen: dict[tuple[str, str], str] = {}
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            key = (method, route.path)
            previous = seen.get(key)
            if previous is not None:
                raise RuntimeError(
                    f"Duplicate API operation {method} {route.path}: {previous} and {route.name}"
                )
            seen[key] = route.name


_assert_unique_operations(api_router)
