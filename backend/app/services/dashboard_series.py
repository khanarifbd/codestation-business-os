"""Read-only, tenant-local historical series; financial source rows are never mirrored.

Income uses confirmed invoice-currency collections plus non-reversed direct income.
Expenses retain reporting's recorded basis, including approved/paid gross payroll
at period end (not cash-paid), excluding separately reported transfer fees.
Counts represent surviving records created, not reconstructed deleted history.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.reports import _expense_scope, _money_entry_scope
from app.models.accounting_money import AccountingMoneyEntry
from app.models.crm import Client
from app.models.expenses import Expense
from app.models.finance import Invoice, Payment
from app.models.orders import Order
from app.models.payroll import PayrollPeriod, PayrollRun
from app.models.projects import Project
from app.schemas.dashboard_series import (
    DashboardCountPoint, DashboardCurrencySeries, DashboardMoneyPoint, DashboardSeries,
)


@dataclass(frozen=True)
class SeriesPlan:
    start: date
    end: date
    effective_end: date | None
    timezone_name: str
    bucket: str
    # Database grouping key and clipped visible bounds.
    periods: tuple[tuple[date, date, date], ...]

    def utc_bounds(self):
        zone = ZoneInfo(self.timezone_name)
        return (
            datetime.combine(self.start, time.min, zone).astimezone(timezone.utc),
            datetime.combine(self.effective_end + timedelta(days=1), time.min, zone).astimezone(timezone.utc),
        )


def plan_series(start: date | None, end: date | None, timezone_name: str, *, now: datetime | None = None) -> SeriesPlan:
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(400, 'Organization timezone is invalid') from None
    today = (now or datetime.now(timezone.utc)).astimezone(zone).date()
    start, end = start or today.replace(day=1), end or today
    days = (end - start).days + 1
    if days < 1:
        raise HTTPException(400, 'Date to cannot be before date from')
    if days > 366:
        raise HTTPException(400, 'Dashboard series date range cannot exceed 366 days')
    bucket = 'day' if days <= 62 else 'month'
    effective = min(today, end)
    periods = []
    cursor = start
    while cursor <= effective:
        key = cursor if bucket == 'day' else cursor.replace(day=1)
        next_start = cursor + timedelta(days=1) if bucket == 'day' else (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        last = min(effective, next_start - timedelta(days=1))
        periods.append((key, cursor, last))
        cursor = last + timedelta(days=1)
    return SeriesPlan(start, end, effective if periods else None, timezone_name, bucket, tuple(periods))


def _key(value):
    return value.date() if isinstance(value, datetime) else value


def _exact(value):
    return format(Decimal(value or 0).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), '.2f')


def dashboard_series(db, org_id: str, plan: SeriesPlan) -> DashboardSeries:
    counts = {key: DashboardCountPoint(period_start=first, period_end=last) for key, first, last in plan.periods}
    money = {}
    if plan.periods:
        lower, upper = plan.utc_bounds()
        for field, model in [('projects', Project), ('orders', Order), ('clients', Client)]:
            period = func.date_trunc(plan.bucket, func.timezone(plan.timezone_name, model.created_at))
            query = select(period, func.count(model.id)).where(
                model.organization_id == org_id, model.created_at >= lower, model.created_at < upper,
            ).group_by(period)
            for key, count in db.execute(query):
                setattr(counts[_key(key)], field, count)

        def add(query, kind):
            for key, currency, amount in db.execute(query):
                key = _key(key)
                values = money.setdefault(currency, {})
                pair = values.setdefault(key, {'income': Decimal(0), 'expenses': Decimal(0)})
                pair[kind] += Decimal(amount or 0)

        # Each source is queried once; FinancialTransaction mirrors are not summed.
        p = func.date_trunc(plan.bucket, Payment.payment_date)
        add(select(p, Payment.invoice_currency, func.sum(Payment.invoice_amount)).join(Invoice, Invoice.id == Payment.invoice_id).where(
            Payment.organization_id == org_id, Invoice.organization_id == org_id,
            Payment.status == 'confirmed', Payment.payment_date >= plan.start,
            Payment.payment_date <= plan.effective_end,
        ).group_by(p, Payment.invoice_currency), 'income')
        p = func.date_trunc(plan.bucket, Expense.expense_date)
        add(_expense_scope(select(p, Expense.expense_currency, func.sum(Expense.expense_amount)), org_id, plan.start, plan.effective_end, None, None, None).group_by(p, Expense.expense_currency), 'expenses')
        p = func.date_trunc(plan.bucket, AccountingMoneyEntry.entry_date)
        for kind, target in [('income', 'income'), ('expense', 'expenses')]:
            add(_money_entry_scope(select(p, AccountingMoneyEntry.currency, func.sum(AccountingMoneyEntry.amount)), org_id, plan.start, plan.effective_end, None, None, None).where(AccountingMoneyEntry.kind == kind).group_by(p, AccountingMoneyEntry.currency), target)
        p = func.date_trunc(plan.bucket, PayrollPeriod.period_end)
        add(select(p, PayrollRun.currency, func.sum(PayrollRun.gross_total)).join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id).where(
            PayrollRun.organization_id == org_id, PayrollPeriod.organization_id == org_id,
            PayrollRun.status.in_(['approved', 'paid']), PayrollPeriod.period_end >= plan.start,
            PayrollPeriod.period_end <= plan.effective_end,
        ).group_by(p, PayrollRun.currency), 'expenses')
    return DashboardSeries(
        organization_id=org_id, date_from=plan.start, date_to=plan.end,
        effective_date_to=plan.effective_end, timezone=plan.timezone_name, bucket=plan.bucket,
        counts=list(counts.values()), money=[DashboardCurrencySeries(currency=currency, points=[
            DashboardMoneyPoint(period_start=first, period_end=last,
                income=_exact(values.get(key, {}).get('income')),
                expenses=_exact(values.get(key, {}).get('expenses')))
            for key, first, last in plan.periods
        ]) for currency, values in sorted(money.items())],
    )
