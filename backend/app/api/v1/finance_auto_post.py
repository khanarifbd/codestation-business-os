from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.expenses import ExpenseCategory, Vendor
from app.models.finance import FinancialAccount
from app.models.finance_controls import RecurringExpense
from app.schemas.finance_auto_post import AutoPostRetry
from app.services.accounting_period_gate import acquire_accounting_period_gate
from app.services.activity_log import record_activity
from app.services.functional_currency import organization_local_date
from app.services.recurring_auto_post import auto_post_eligibility, post_due_recurring_expense
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
    retryable: bool
    last_attempt_at: datetime | None
    last_error: str | None


def _read(db: DbSession, item: RecurringExpense, today: date) -> AutoPostRow:
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
        retryable=bool(item.auto_post_last_error) and item.is_active and item.auto_post and item.next_due_date <= today,
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
    today = organization_local_date(tenant.organization)
    return [_read(db, item, today) for item in items]


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
        .execution_options(populate_existing=True)
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
    return _read(db, item, organization_local_date(tenant.organization))


@router.post("/recurring-auto-post/{recurring_id}/retry", response_model=AutoPostRow)
def retry_recurring_auto_post(
    recurring_id: str,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
    payload: AutoPostRetry | None = None,
):
    acquire_accounting_period_gate(db, tenant.organization_id)
    db.refresh(tenant.organization, attribute_names=["timezone"])
    now = datetime.now(timezone.utc)
    today = organization_local_date(tenant.organization)
    item = db.scalar(
        select(RecurringExpense)
        .where(RecurringExpense.id == recurring_id, RecurringExpense.organization_id == tenant.organization_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Recurring expense not found")
    if (
        payload is not None
        and payload.expected_next_due_date is not None
        and payload.expected_next_due_date != item.next_due_date
    ):
        raise HTTPException(
            status_code=409,
            detail="The reviewed due occurrence changed. Read the current schedule and review it again before a new attempt.",
        )
    if not item.auto_post or not item.is_active:
        raise HTTPException(status_code=409, detail="Enable Auto Post and resume this schedule before retrying")
    if item.next_due_date > today:
        raise HTTPException(status_code=409, detail=f"This schedule is not due until {item.next_due_date.isoformat()}")
    attempted_due_date = item.next_due_date
    business_completed = False
    try:
        post_due_recurring_expense(db, item, now=now)
        business_completed = True
        record_activity(
            db,
            action="finance.recurring_expense.auto_post_retried",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="recurring_expense",
            entity_id=item.id,
            after={"next_due_date": item.next_due_date.isoformat(), "last_posted_expense_id": item.last_posted_expense_id},
            metadata={"mode": "manual_retry"},
            message=f"Auto Post retry succeeded for {item.name}",
            request=request,
        )
        # Materialize/validate response before commit. No postcommit read can
        # turn an acknowledged expense into a retry-safe failure response.
        result = _read(db, item, today).model_copy(deep=True)
    except Exception as exc:
        db.rollback()
        known_rejection = isinstance(exc, ValueError) or (
            isinstance(exc, HTTPException) and exc.status_code in {400, 404, 409, 422}
        )
        if business_completed or not known_rejection:
            raise
        message = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        failed = db.scalar(
            select(RecurringExpense)
            .where(RecurringExpense.id == recurring_id, RecurringExpense.organization_id == tenant.organization_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        # Another writer can advance after our rollback. Never label its newer
        # occurrence as the one rejected by this attempt.
        if failed is not None and failed.next_due_date == attempted_due_date:
            failed.auto_post_last_attempt_at = now
            failed.auto_post_last_error = message[:2000]
            record_activity(
                db,
                action="finance.recurring_expense.auto_post_retry_failed",
                scope="tenant",
                actor_user_id=tenant.user_id,
                organization_id=tenant.organization_id,
                entity_type="recurring_expense",
                entity_id=failed.id,
                outcome="failure",
                after={"due_date": failed.next_due_date.isoformat(), "error": failed.auto_post_last_error},
                metadata={"mode": "manual_retry"},
                message=f"Auto Post retry failed for {failed.name}",
                request=request,
            )
            db.commit()
        else:
            db.rollback()
        raise HTTPException(status_code=409, detail=message) from exc
    # A commit exception can mean a lost acknowledgement. Do not record a
    # definitive failed posting, perform a readback, or retry this transaction.
    try:
        db.commit()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="The Auto Post commit outcome could not be confirmed. Inspect saved expense records before another attempt.",
        ) from exc
    return result
