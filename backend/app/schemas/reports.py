from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class ReportFinancialRow(BaseModel):
    currency: str
    invoiced_revenue: Decimal
    collected_revenue: Decimal
    receivables: Decimal
    expenses: Decimal
    platform_fees: Decimal
    transfer_fees: Decimal
    net_profit: Decimal


class ReportTrendRow(BaseModel):
    period: str
    currency: str
    invoiced_revenue: Decimal
    collected_revenue: Decimal
    expenses: Decimal
    transfer_fees: Decimal
    net_profit: Decimal


class ReportAccountBalance(BaseModel):
    account_id: str
    account_name: str
    account_type: str
    currency: str
    balance: Decimal


class ReportOperationalSummary(BaseModel):
    open_leads: int
    active_clients: int
    open_quotations: int
    open_orders: int
    active_projects: int
    overdue_tasks: int
    due_followups: int
    open_invoices: int
    overdue_invoices: int


class ReportProjectRow(BaseModel):
    project_id: str
    project_number: str
    project_name: str
    client_name: str
    currency: str
    contract_value: Decimal
    invoiced_revenue: Decimal
    collected_revenue: Decimal
    direct_expenses: Decimal
    estimated_profit: Decimal
    margin_percent: Decimal | None


class ReportClientRow(BaseModel):
    client_id: str
    client_name: str
    currency: str
    invoiced_revenue: Decimal
    collected_revenue: Decimal
    direct_expenses: Decimal
    estimated_profit: Decimal
    margin_percent: Decimal | None


class ReportsOverview(BaseModel):
    date_from: date
    date_to: date
    financials: list[ReportFinancialRow]
    trend: list[ReportTrendRow]
    accounts: list[ReportAccountBalance]
    operations: ReportOperationalSummary
    projects: list[ReportProjectRow]
    clients: list[ReportClientRow]


class ReportMetaItem(BaseModel):
    id: str
    label: str


class ReportsMeta(BaseModel):
    currencies: list[str]
    clients: list[ReportMetaItem]
    projects: list[ReportMetaItem]
