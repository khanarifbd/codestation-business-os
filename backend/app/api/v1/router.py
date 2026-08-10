from fastapi import APIRouter

from app.api.v1.accounting import router as accounting_router
from app.api.v1.accounting_accounts import router as accounting_accounts_router
from app.api.v1.accounting_loan_details import router as accounting_loan_details_router
from app.api.v1.accounting_loans import router as accounting_loans_router
from app.api.v1.accounting_money import router as accounting_money_router
from app.api.v1.accounting_reports import router as accounting_reports_router
from app.api.v1.accounting_sync import router as accounting_sync_router
from app.api.v1.activity_logs import platform_activity_router, tenant_activity_router
from app.api.v1.auth import router as auth_router
from app.api.v1.capital import router as capital_router
from app.api.v1.capital_insights import router as capital_insights_router
from app.api.v1.company_defaults import router as company_defaults_router
from app.api.v1.company_settings import router as company_settings_router
from app.api.v1.company_uploads import router as company_uploads_router
from app.api.v1.crm import router as crm_router
from app.api.v1.crm_clients import router as crm_clients_router
from app.api.v1.crm_status import router as crm_status_router
from app.api.v1.crm_summary import router as crm_summary_router
from app.api.v1.customer_advances import router as customer_advances_router
from app.api.v1.exchange_rates import router as exchange_rates_router
from app.api.v1.finance import router as finance_router
from app.api.v1.finance_auto_post import router as finance_auto_post_router
from app.api.v1.finance_controls import router as finance_controls_router
from app.api.v1.finance_expenses import router as finance_expenses_router
from app.api.v1.finance_invoice_drafts import router as finance_invoice_drafts_router
from app.api.v1.finance_pagination import router as finance_pagination_router
from app.api.v1.finance_transfers import router as finance_transfers_router
from app.api.v1.health import router as health_router
from app.api.v1.hr import router as hr_router
from app.api.v1.hr_extended import router as hr_extended_router
from app.api.v1.hr_self import router as hr_self_router
from app.api.v1.hr_uploads import router as hr_uploads_router
from app.api.v1.order_links import router as order_links_router
from app.api.v1.orders import router as orders_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.payables import router as payables_router
from app.api.v1.payroll import router as payroll_router
from app.api.v1.platform import router as platform_router
from app.api.v1.project_execution import router as project_execution_router
from app.api.v1.projects import router as projects_router
from app.api.v1.reports_fast import router as reports_fast_router
from app.api.v1.reports import router as reports_router
from app.api.v1.sales import router as sales_router
from app.api.v1.team import invitation_router, router as team_router
from app.api.v1.tenant import router as tenant_router
from app.api.v1.workspace import router as workspace_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(invitation_router)
api_router.include_router(organizations_router)
api_router.include_router(tenant_router)
api_router.include_router(team_router)
api_router.include_router(hr_router)
api_router.include_router(hr_extended_router)
api_router.include_router(hr_self_router)
api_router.include_router(hr_uploads_router)
api_router.include_router(crm_summary_router)
api_router.include_router(crm_status_router)
api_router.include_router(crm_clients_router)
api_router.include_router(crm_router)
api_router.include_router(sales_router)
api_router.include_router(orders_router)
api_router.include_router(order_links_router)
api_router.include_router(projects_router)
api_router.include_router(project_execution_router)
api_router.include_router(accounting_router)
api_router.include_router(accounting_accounts_router)
api_router.include_router(accounting_loans_router)
api_router.include_router(accounting_loan_details_router)
api_router.include_router(accounting_money_router)
api_router.include_router(accounting_sync_router)
api_router.include_router(accounting_reports_router)
api_router.include_router(customer_advances_router)
api_router.include_router(payables_router)
api_router.include_router(finance_router)
api_router.include_router(finance_invoice_drafts_router)
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
api_router.include_router(workspace_router)
api_router.include_router(company_uploads_router)
api_router.include_router(company_settings_router)
api_router.include_router(company_defaults_router)
api_router.include_router(exchange_rates_router)
api_router.include_router(tenant_activity_router)
api_router.include_router(platform_router)
api_router.include_router(platform_activity_router)
