from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from typing import Annotated

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.expenses import ExpenseCategory, Vendor
from app.models.finance import FinancialAccount
from app.models.finance_controls import RecurringExpense
from app.models.projects import Project
from app.services.activity_log import record_activity
from app.services.recurring_auto_post import auto_post_eligibility
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Recurring Auto Post"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


class AutoPostToggle(BaseModel):
    enabled: bool


class AutoPostRow(BaseModel):
    id: str
    name: str
    description: str
    category_name: str
    vendor_name: str | None
    account_name: str
    account_currency: str
    expense_currency: str
    expense_amount: str
    frequency: str
    interval_count: int
    next_due_date: str
    is_active: bool
    auto_post: bool
    eligible: bool
    eligibility_reason: str | None
    last_attempt_at: datetime | None
    last_error: str | None


def _read(db: DbSession, item: RecurringExpense) -> AutoPostRow:
    account = db.get(FinancialAccount, item.account_id)
    category = db.get(ExpenseCategory, item.category_id)
    vendor = db.get(Vendor, item.vendor_id) if item.vendor_id else None
    eligible, reason = auto_post_eligibility(db, item)
    return AutoPostRow(
        id=item.id,
        name=item.name,
        description=item.description,
        category_name=category.name if category else "Unavailable category",
        vendor_name=vendor.name if vendor else None,
        account_name=account.name if account else "Unavailable account",
        account_currency=account.currency if account else "—",
        expense_currency=item.expense_currency,
        expense_amount=str(item.expense_amount),
        frequency=item.frequency,
        interval_count=item.interval_count,
        next_due_date=item.next_due_date.isoformat(),
        is_active=item.is_active,
        auto_post=item.auto_post,
        eligible=eligible,
        eligibility_reason=reason,
        last_attempt_at=item.auto_post_last_attempt_at,
        last_error=item.auto_post_last_error,
    )


@router.get("/recurring-auto-post", response_model=list[AutoPostRow])
def list_recurring_auto_post(db: DbSession, tenant: FinanceViewer):
    items = db.scalars(
        select(RecurringExpense)
        .where(RecurringExpense.organization_id == tenant.organization_id)
        .order_by(RecurringExpense.is_active.desc(), RecurringExpense.next_due_date.asc(), RecurringExpense.name.asc())
    ).all()
    return [_read(db, item) for item in items]


@router.patch("/recurring-auto-post/{recurring_id}", response_model=AutoPostRow)
def set_recurring_auto_post(
    recurring_id: str,
    payload: AutoPostToggle,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
):
    item = db.scalar(
        select(RecurringExpense)
        .where(RecurringExpense.id == recurring_id, RecurringExpense.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Recurring expense not found")
    if payload.enabled:
        if not item.is_active:
            raise HTTPException(status_code=409, detail="Resume the recurring expense before enabling Auto Post")
        eligible, reason = auto_post_eligibility(db, item)
        if not eligible:
            raise HTTPException(status_code=409, detail=reason or "This recurring expense is not eligible for Auto Post")
    before = item.auto_post
    item.auto_post = payload.enabled
    item.auto_post_last_error = None
    db.flush()
    record_activity(
        db,
        action="finance.recurring_expense.auto_post_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="recurring_expense",
        entity_id=item.id,
        before={"auto_post": before},
        after={"auto_post": item.auto_post},
        message=f"Auto Post {'enabled' if item.auto_post else 'disabled'} for {item.name}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return _read(db, item)
