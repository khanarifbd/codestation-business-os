from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.customer_advances import CustomerAdvance, CustomerAdvanceApplication
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
from app.schemas.customer_advances import CustomerAdvanceApply, CustomerAdvanceCreate, CustomerAdvanceRead
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account, to_base_amount
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/customer-advances", tags=["Customer Advances"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _read(db: DbSession, organization_id: str, item: CustomerAdvance) -> CustomerAdvanceRead:
    row = db.execute(
        select(Client.display_name, FinancialAccount.name)
        .join(FinancialAccount, FinancialAccount.id == item.financial_account_id)
        .where(Client.id == item.client_id, Client.organization_id == organization_id, FinancialAccount.organization_id == organization_id)
    ).first()
    return CustomerAdvanceRead(
        id=item.id, client_id=item.client_id, client_name=row[0] if row else "—",
        financial_account_id=item.financial_account_id, financial_account_name=row[1] if row else "—",
        advance_date=item.advance_date, currency=item.currency, original_amount=item.original_amount,
        remaining_amount=item.remaining_amount, reference=item.reference, notes=item.notes, created_at=item.created_at,
    )


@router.get("", response_model=list[CustomerAdvanceRead])
def list_advances(db: DbSession, tenant: Viewer, open_only: bool = False):
    query = select(CustomerAdvance).where(CustomerAdvance.organization_id == tenant.organization_id)
    if open_only:
        query = query.where(CustomerAdvance.remaining_amount > 0)
    items = db.scalars(query.order_by(CustomerAdvance.advance_date.desc(), CustomerAdvance.created_at.desc()).limit(300)).all()
    return [_read(db, tenant.organization_id, item) for item in items]


@router.post("", response_model=CustomerAdvanceRead, status_code=status.HTTP_201_CREATED)
def create_advance(payload: CustomerAdvanceCreate, request: Request, db: DbSession, tenant: Manager):
    client = db.scalar(select(Client).where(Client.id == payload.client_id, Client.organization_id == tenant.organization_id, Client.status == "active"))
    if client is None:
        raise HTTPException(status_code=404, detail="Active client not found")
    account, account_ledger = financial_ledger_account(db, tenant.organization_id, payload.financial_account_id)
    if account.account_type == "credit_card":
        raise HTTPException(status_code=400, detail="Customer advance cannot be received into a credit card")
    if client.currency and client.currency.upper() != account.currency.upper():
        raise HTTPException(status_code=409, detail=f"Use a {client.currency.upper()} account for this client advance. Cross-currency customer advances are not enabled in the simple workflow yet.")
    amount = _money(payload.amount)
    advance = CustomerAdvance(
        organization_id=tenant.organization_id, client_id=client.id, financial_account_id=account.id,
        advance_date=payload.advance_date, currency=account.currency, original_amount=amount, remaining_amount=amount,
        reference=payload.reference.strip() if payload.reference else None, notes=payload.notes.strip() if payload.notes else None,
        created_by_user_id=tenant.user_id,
    )
    db.add(advance); db.flush()
    liability = system_account(db, tenant.organization_id, "customer_advances")
    base_amount, rate = to_base_amount(db, tenant.organization_id, tenant.organization.currency, amount, account.currency)
    post_journal(
        db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=advance.advance_date,
        source_type="customer_advance", source_id=advance.id,
        lines=[
            PostingLine(ledger_account_id=account_ledger.id, debit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=amount, description=f"Advance from {client.display_name}"),
            PostingLine(ledger_account_id=liability.id, credit=base_amount, currency=account.currency, exchange_rate_to_base=rate, original_amount=amount, description=f"Customer advance — {client.display_name}"),
        ], reference=advance.reference, memo=f"Customer advance received from {client.display_name}",
    )
    db.add(FinancialTransaction(
        organization_id=tenant.organization_id, account_id=account.id, transaction_date=advance.advance_date,
        direction="credit", amount=amount, currency=account.currency, source_type="customer_advance", source_id=advance.id,
        reference=advance.reference, description=f"Customer advance from {client.display_name}", created_by_user_id=tenant.user_id,
    ))
    record_activity(db, action="accounting.customer_advance.received", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="customer_advance", entity_id=advance.id, after={"client_id":client.id,"amount":str(amount),"currency":account.currency,"account_id":account.id}, message=f"Customer advance received from {client.display_name}: {account.currency} {amount}", request=request)
    db.commit(); db.refresh(advance)
    return _read(db, tenant.organization_id, advance)


@router.post("/{advance_id}/apply", response_model=CustomerAdvanceRead)
def apply_advance(advance_id: str, payload: CustomerAdvanceApply, request: Request, db: DbSession, tenant: Manager):
    advance = db.scalar(select(CustomerAdvance).where(CustomerAdvance.id == advance_id, CustomerAdvance.organization_id == tenant.organization_id).with_for_update())
    if advance is None:
        raise HTTPException(status_code=404, detail="Customer advance not found")
    invoice = db.scalar(select(Invoice).where(Invoice.id == payload.invoice_id, Invoice.organization_id == tenant.organization_id).with_for_update())
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.client_id != advance.client_id:
        raise HTTPException(status_code=400, detail="Advance and invoice must belong to the same client")
    if invoice.status in {"draft", "cancelled", "paid"}:
        raise HTTPException(status_code=409, detail="Advance can only be applied to an open invoice")
    if invoice.currency != advance.currency:
        raise HTTPException(status_code=409, detail="Advance and invoice must use the same currency")
    amount = _money(payload.amount)
    if amount > advance.remaining_amount:
        raise HTTPException(status_code=409, detail=f"Advance has only {advance.remaining_amount} {advance.currency} remaining")
    if amount > invoice.balance_due:
        raise HTTPException(status_code=409, detail=f"Invoice has only {invoice.balance_due} {invoice.currency} due")
    application = CustomerAdvanceApplication(organization_id=tenant.organization_id, advance_id=advance.id, invoice_id=invoice.id, application_date=payload.application_date, currency=advance.currency, amount=amount, created_by_user_id=tenant.user_id)
    db.add(application); db.flush()
    liability = system_account(db, tenant.organization_id, "customer_advances")
    ar = system_account(db, tenant.organization_id, "accounts_receivable")
    base_amount, rate = to_base_amount(db, tenant.organization_id, tenant.organization.currency, amount, advance.currency)
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=payload.application_date, source_type="customer_advance_application", source_id=application.id, lines=[PostingLine(ledger_account_id=liability.id,debit=base_amount,currency=advance.currency,exchange_rate_to_base=rate,original_amount=amount,description=f"Apply advance to {invoice.invoice_number}"),PostingLine(ledger_account_id=ar.id,credit=base_amount,currency=invoice.currency,exchange_rate_to_base=rate,original_amount=amount,description=f"Apply advance to {invoice.invoice_number}")], reference=invoice.invoice_number, memo=f"Customer advance applied to {invoice.invoice_number}")
    advance.remaining_amount = _money(advance.remaining_amount - amount)
    invoice.amount_paid = _money(invoice.amount_paid + amount)
    invoice.balance_due = _money(invoice.total - invoice.amount_paid)
    if invoice.balance_due <= 0:
        invoice.balance_due = Decimal("0.00"); invoice.status = "paid"; invoice.paid_at = datetime.now(timezone.utc)
    else:
        invoice.status = "partially_paid"; invoice.paid_at = None
    record_activity(db, action="accounting.customer_advance.applied", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="customer_advance_application", entity_id=application.id, after={"advance_id":advance.id,"invoice_id":invoice.id,"amount":str(amount),"advance_remaining":str(advance.remaining_amount),"invoice_balance_due":str(invoice.balance_due)}, message=f"Customer advance applied to {invoice.invoice_number}", request=request)
    db.commit(); db.refresh(advance)
    return _read(db, tenant.organization_id, advance)
