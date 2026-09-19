from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine
from app.models.crm import Client
from app.models.customer_advances import CustomerAdvance, CustomerAdvanceApplication
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.schemas.customer_advances import CustomerAdvanceApply, CustomerAdvanceCreate, CustomerAdvanceRead
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account, to_base_amount
from app.services.activity_log import record_activity
from app.services.functional_currency import functional_currency_for_date
from app.services.operational_posting import post_invoice_issue
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


def _source_journal(db: DbSession, organization_id: str, source_type: str, source_id: str) -> JournalEntry:
    journal = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )
    if journal is None:
        raise HTTPException(status_code=409, detail=f"Required accounting journal is missing for {source_type}/{source_id}")
    return journal


def _advance_liability_carrying_base(
    db: DbSession,
    organization_id: str,
    advance: CustomerAdvance,
    current_application_id: str,
    liability_account_id: str,
    application_amount: Decimal,
) -> Decimal:
    receipt = _source_journal(db, organization_id, "customer_advance", advance.id)
    receipt_base = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(JournalLine.credit), 0)).where(
                JournalLine.organization_id == organization_id,
                JournalLine.journal_entry_id == receipt.id,
                JournalLine.ledger_account_id == liability_account_id,
            )
        )
        or 0
    )

    reversed_entry = JournalEntry.__table__.alias("advance_application_reversal")
    prior = db.execute(
        select(CustomerAdvanceApplication.amount, JournalLine.debit)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == CustomerAdvanceApplication.organization_id)
            & (JournalEntry.source_type == "customer_advance_application")
            & (JournalEntry.source_id == CustomerAdvanceApplication.id)
            & (JournalEntry.status == "posted"),
        )
        .join(
            JournalLine,
            (JournalLine.organization_id == CustomerAdvanceApplication.organization_id)
            & (JournalLine.journal_entry_id == JournalEntry.id)
            & (JournalLine.ledger_account_id == liability_account_id),
        )
        .where(
            CustomerAdvanceApplication.organization_id == organization_id,
            CustomerAdvanceApplication.advance_id == advance.id,
            CustomerAdvanceApplication.id != current_application_id,
            ~select(reversed_entry.c.id)
            .where(
                reversed_entry.c.organization_id == organization_id,
                reversed_entry.c.reversed_entry_id == JournalEntry.id,
            )
            .exists(),
        )
    ).all()

    prior_original = _money(sum((Decimal(original) for original, _ in prior), Decimal("0")))
    prior_base = _money(sum((Decimal(base) for _, base in prior), Decimal("0")))
    remaining_original = _money(Decimal(advance.original_amount) - prior_original)
    remaining_base = _money(receipt_base - prior_base)
    application_amount = _money(application_amount)
    if remaining_original <= 0 or remaining_base <= 0:
        raise HTTPException(status_code=409, detail="Customer advance carrying value is unavailable")
    if application_amount >= remaining_original:
        return remaining_base
    return _money(remaining_base * application_amount / remaining_original)


def _invoice_receivable_carrying_base(
    db: DbSession,
    organization_id: str,
    invoice: Invoice,
    current_application_id: str,
    ar_account_id: str,
    application_amount: Decimal,
) -> Decimal:
    issue = _source_journal(db, organization_id, "invoice_issue", invoice.id)
    issue_base = Decimal(
        db.scalar(
            select(func.coalesce(func.sum(JournalLine.debit), 0)).where(
                JournalLine.organization_id == organization_id,
                JournalLine.journal_entry_id == issue.id,
                JournalLine.ledger_account_id == ar_account_id,
            )
        )
        or 0
    )

    payment_rows = db.execute(
        select(Payment.invoice_amount, JournalLine.credit)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == Payment.organization_id)
            & (JournalEntry.source_type == "invoice_payment")
            & (JournalEntry.source_id == Payment.id)
            & (JournalEntry.status == "posted"),
        )
        .join(
            JournalLine,
            (JournalLine.organization_id == Payment.organization_id)
            & (JournalLine.journal_entry_id == JournalEntry.id)
            & (JournalLine.ledger_account_id == ar_account_id),
        )
        .where(
            Payment.organization_id == organization_id,
            Payment.invoice_id == invoice.id,
            Payment.status == "confirmed",
        )
    ).all()

    reversed_entry = JournalEntry.__table__.alias("advance_ar_reversal")
    advance_rows = db.execute(
        select(CustomerAdvanceApplication.amount, JournalLine.credit)
        .join(
            JournalEntry,
            (JournalEntry.organization_id == CustomerAdvanceApplication.organization_id)
            & (JournalEntry.source_type == "customer_advance_application")
            & (JournalEntry.source_id == CustomerAdvanceApplication.id)
            & (JournalEntry.status == "posted"),
        )
        .join(
            JournalLine,
            (JournalLine.organization_id == CustomerAdvanceApplication.organization_id)
            & (JournalLine.journal_entry_id == JournalEntry.id)
            & (JournalLine.ledger_account_id == ar_account_id),
        )
        .where(
            CustomerAdvanceApplication.organization_id == organization_id,
            CustomerAdvanceApplication.invoice_id == invoice.id,
            CustomerAdvanceApplication.id != current_application_id,
            ~select(reversed_entry.c.id)
            .where(
                reversed_entry.c.organization_id == organization_id,
                reversed_entry.c.reversed_entry_id == JournalEntry.id,
            )
            .exists(),
        )
    ).all()

    settled_original = _money(
        sum((Decimal(original) for original, _ in payment_rows), Decimal("0"))
        + sum((Decimal(original) for original, _ in advance_rows), Decimal("0"))
    )
    settled_base = _money(
        sum((Decimal(base) for _, base in payment_rows), Decimal("0"))
        + sum((Decimal(base) for _, base in advance_rows), Decimal("0"))
    )
    remaining_original = _money(Decimal(invoice.total) - settled_original)
    remaining_base = _money(issue_base - settled_base)
    application_amount = _money(application_amount)
    if remaining_original <= 0 or remaining_base <= 0:
        raise HTTPException(status_code=409, detail="Invoice receivable carrying value is unavailable")
    if application_amount >= remaining_original:
        return remaining_base
    return _money(remaining_base * application_amount / remaining_original)


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
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Advance amount must be at least 0.01")
    advance = CustomerAdvance(
        organization_id=tenant.organization_id, client_id=client.id, financial_account_id=account.id,
        advance_date=payload.advance_date, currency=account.currency, original_amount=amount, remaining_amount=amount,
        reference=payload.reference.strip() if payload.reference else None, notes=payload.notes.strip() if payload.notes else None,
        created_by_user_id=tenant.user_id,
    )
    db.add(advance); db.flush()
    liability = system_account(db, tenant.organization_id, "customer_advances")
    base_amount, rate = to_base_amount(
        db,
        tenant.organization_id,
        functional_currency_for_date(db, tenant.organization_id, advance.advance_date),
        amount,
        account.currency,
        rate_date=advance.advance_date,
    )
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
    if payload.application_date < advance.advance_date:
        raise HTTPException(status_code=409, detail="Advance application date cannot be earlier than the advance receipt date")
    if payload.application_date < invoice.issue_date:
        raise HTTPException(status_code=409, detail="Advance application date cannot be earlier than the invoice issue date")
    amount = _money(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Applied advance amount must be at least 0.01")
    if amount > advance.remaining_amount:
        raise HTTPException(status_code=409, detail=f"Advance has only {advance.remaining_amount} {advance.currency} remaining")
    if amount > invoice.balance_due:
        raise HTTPException(status_code=409, detail=f"Invoice has only {invoice.balance_due} {invoice.currency} due")

    # Older sent invoices may predate immediate operational posting. Ensure the
    # receivable source journal exists before deriving its historical carrying value.
    post_invoice_issue(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        invoice=invoice,
    )

    application = CustomerAdvanceApplication(organization_id=tenant.organization_id, advance_id=advance.id, invoice_id=invoice.id, application_date=payload.application_date, currency=advance.currency, amount=amount, created_by_user_id=tenant.user_id)
    db.add(application); db.flush()
    liability = system_account(db, tenant.organization_id, "customer_advances")
    ar = system_account(db, tenant.organization_id, "accounts_receivable")

    liability_base = _advance_liability_carrying_base(
        db,
        tenant.organization_id,
        advance,
        application.id,
        liability.id,
        amount,
    )
    receivable_base = _invoice_receivable_carrying_base(
        db,
        tenant.organization_id,
        invoice,
        application.id,
        ar.id,
        amount,
    )
    liability_rate = (liability_base / amount).quantize(Decimal("0.00000001"))
    receivable_rate = (receivable_base / amount).quantize(Decimal("0.00000001"))
    lines = [
        PostingLine(
            ledger_account_id=liability.id,
            debit=liability_base,
            currency=advance.currency,
            exchange_rate_to_base=liability_rate,
            original_amount=amount,
            description=f"Apply advance to {invoice.invoice_number}",
        ),
        PostingLine(
            ledger_account_id=ar.id,
            credit=receivable_base,
            currency=invoice.currency,
            exchange_rate_to_base=receivable_rate,
            original_amount=amount,
            description=f"Apply advance to {invoice.invoice_number}",
        ),
    ]
    fx_difference = _money(receivable_base - liability_base)
    functional_currency = functional_currency_for_date(db, tenant.organization_id, payload.application_date)
    if fx_difference > 0:
        fx_loss = system_account(db, tenant.organization_id, "realized_fx_loss")
        lines.append(
            PostingLine(
                ledger_account_id=fx_loss.id,
                debit=fx_difference,
                currency=functional_currency,
                original_amount=fx_difference,
                description=f"Realized FX loss applying customer advance to {invoice.invoice_number}",
            )
        )
    elif fx_difference < 0:
        fx_gain = system_account(db, tenant.organization_id, "realized_fx_gain")
        lines.append(
            PostingLine(
                ledger_account_id=fx_gain.id,
                credit=abs(fx_difference),
                currency=functional_currency,
                original_amount=abs(fx_difference),
                description=f"Realized FX gain applying customer advance to {invoice.invoice_number}",
            )
        )
    post_journal(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        entry_date=payload.application_date,
        source_type="customer_advance_application",
        source_id=application.id,
        lines=lines,
        reference=invoice.invoice_number,
        memo=f"Customer advance applied to {invoice.invoice_number}",
    )
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
