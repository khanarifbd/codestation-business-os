"""Shared invoice payment-instructions snapshot logic for create and draft edit."""

from fastapi import HTTPException
from sqlalchemy import select

from app.models.finance import FinancialAccount, Invoice
from app.schemas.invoice_payment import InvoicePaymentInstructionsUpdate


def apply_invoice_payment_instructions(
    db,
    *,
    organization_id: str,
    invoice: Invoice,
    payload: InvoicePaymentInstructionsUpdate,
) -> None:
    """Validate the tenant-owned destination and snapshot immutable client payment details.

    Caller flushes, audits and commits along with the invoice create/edit transaction.
    """
    if invoice.organization_id != organization_id or invoice.status != "draft":
        raise HTTPException(status_code=409, detail="Only this organization's draft invoices can update payment instructions")

    account = None
    if payload.payment_account_id:
        account = db.scalar(
            select(FinancialAccount).where(
                FinancialAccount.id == payload.payment_account_id,
                FinancialAccount.organization_id == organization_id,
                FinancialAccount.is_active.is_(True),
                FinancialAccount.account_type != "credit_card",
            )
        )
        if account is None:
            raise HTTPException(status_code=404, detail="Active payment destination not found")

    invoice.payment_method = payload.payment_method
    invoice.payment_account_id = account.id if account else None
    invoice.payment_account_name_snapshot = account.name if account else None
    invoice.payment_provider_snapshot = account.provider_name if account else None
    invoice.payment_account_holder_snapshot = account.account_holder_name if account else None
    invoice.payment_account_reference_snapshot = account.account_reference if account else None
    invoice.payment_currency_snapshot = account.currency if account else None
    invoice.payment_url_snapshot = payload.payment_url
    invoice.payment_instructions_snapshot = payload.payment_instructions
