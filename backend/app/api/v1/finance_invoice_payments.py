from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import FinancialAccount, Invoice
from app.schemas.invoice_payment import (
    InvoicePaymentInstructionsRead,
    InvoicePaymentInstructionsUpdate,
    PaymentDestinationRead,
    PaymentDestinationSettingsUpdate,
)
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Finance"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _destination_read(account: FinancialAccount) -> PaymentDestinationRead:
    return PaymentDestinationRead(
        id=account.id,
        name=account.name,
        account_type=account.account_type,
        provider_name=account.provider_name,
        account_holder_name=account.account_holder_name,
        account_reference=account.account_reference,
        currency=account.currency,
        payment_url=account.payment_url,
        payment_instructions=account.payment_instructions,
    )


def _invoice_payment_read(invoice: Invoice) -> InvoicePaymentInstructionsRead:
    return InvoicePaymentInstructionsRead(
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        invoice_status=invoice.status,
        invoice_currency=invoice.currency,
        payment_method=invoice.payment_method,
        payment_account_id=invoice.payment_account_id,
        payment_account_name=invoice.payment_account_name_snapshot,
        payment_provider=invoice.payment_provider_snapshot,
        payment_account_holder=invoice.payment_account_holder_snapshot,
        payment_account_reference=invoice.payment_account_reference_snapshot,
        payment_currency=invoice.payment_currency_snapshot,
        payment_url=invoice.payment_url_snapshot,
        payment_instructions=invoice.payment_instructions_snapshot,
        locked=invoice.status != "draft",
    )


@router.get("/payment-destinations", response_model=list[PaymentDestinationRead])
def list_payment_destinations(db: DbSession, tenant: FinanceViewer):
    accounts = db.scalars(
        select(FinancialAccount)
        .where(
            FinancialAccount.organization_id == tenant.organization_id,
            FinancialAccount.is_active.is_(True),
            FinancialAccount.account_type != "credit_card",
        )
        .order_by(FinancialAccount.currency.asc(), FinancialAccount.name.asc())
    ).all()
    return [_destination_read(account) for account in accounts]


@router.patch("/payment-destinations/{account_id}", response_model=PaymentDestinationRead)
def update_payment_destination_defaults(
    account_id: str,
    payload: PaymentDestinationSettingsUpdate,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
):
    account = db.scalar(
        select(FinancialAccount)
        .where(FinancialAccount.id == account_id, FinancialAccount.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Financial account not found")

    before = {
        "payment_url_configured": bool(account.payment_url),
        "payment_instructions_configured": bool(account.payment_instructions),
    }
    if "payment_url" in payload.model_fields_set:
        account.payment_url = payload.payment_url
    if "payment_instructions" in payload.model_fields_set:
        account.payment_instructions = _clean(payload.payment_instructions)
    db.flush()
    record_activity(
        db,
        action="finance.payment_destination.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="financial_account",
        entity_id=account.id,
        before=before,
        after={
            "payment_url_configured": bool(account.payment_url),
            "payment_instructions_configured": bool(account.payment_instructions),
        },
        message=f"Client payment defaults updated for {account.name}",
        request=request,
    )
    db.commit()
    db.refresh(account)
    return _destination_read(account)


@router.get("/invoices/{invoice_id}/payment-instructions", response_model=InvoicePaymentInstructionsRead)
def get_invoice_payment_instructions(invoice_id: str, db: DbSession, tenant: FinanceViewer):
    invoice = db.scalar(
        select(Invoice).where(
            Invoice.id == invoice_id,
            Invoice.organization_id == tenant.organization_id,
        )
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return _invoice_payment_read(invoice)


@router.patch("/invoices/{invoice_id}/payment-instructions", response_model=InvoicePaymentInstructionsRead)
def update_invoice_payment_instructions(
    invoice_id: str,
    payload: InvoicePaymentInstructionsUpdate,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
):
    invoice = db.scalar(
        select(Invoice)
        .where(Invoice.id == invoice_id, Invoice.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status != "draft":
        raise HTTPException(status_code=409, detail="Payment instructions are locked after an invoice is sent")

    account = None
    if payload.payment_account_id:
        account = db.scalar(
            select(FinancialAccount).where(
                FinancialAccount.id == payload.payment_account_id,
                FinancialAccount.organization_id == tenant.organization_id,
                FinancialAccount.is_active.is_(True),
                FinancialAccount.account_type != "credit_card",
            )
        )
        if account is None:
            raise HTTPException(status_code=404, detail="Active payment destination not found")

    before = {
        "payment_method": invoice.payment_method,
        "payment_account_id": invoice.payment_account_id,
        "payment_url_configured": bool(invoice.payment_url_snapshot),
        "payment_instructions_configured": bool(invoice.payment_instructions_snapshot),
    }

    configured = bool(payload.payment_method or account or payload.payment_url or payload.payment_instructions)
    if not configured:
        invoice.payment_method = None
        invoice.payment_account_id = None
        invoice.payment_account_name_snapshot = None
        invoice.payment_provider_snapshot = None
        invoice.payment_account_holder_snapshot = None
        invoice.payment_account_reference_snapshot = None
        invoice.payment_currency_snapshot = None
        invoice.payment_url_snapshot = None
        invoice.payment_instructions_snapshot = None
    else:
        invoice.payment_method = payload.payment_method
        invoice.payment_account_id = account.id if account else None
        invoice.payment_account_name_snapshot = account.name if account else None
        invoice.payment_provider_snapshot = account.provider_name if account else None
        invoice.payment_account_holder_snapshot = account.account_holder_name if account else None
        invoice.payment_account_reference_snapshot = account.account_reference if account else None
        invoice.payment_currency_snapshot = account.currency if account else None
        invoice.payment_url_snapshot = payload.payment_url
        invoice.payment_instructions_snapshot = _clean(payload.payment_instructions)

    db.flush()
    record_activity(
        db,
        action="finance.invoice.payment_instructions_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="invoice",
        entity_id=invoice.id,
        before=before,
        after={
            "payment_method": invoice.payment_method,
            "payment_account_id": invoice.payment_account_id,
            "payment_currency": invoice.payment_currency_snapshot,
            "payment_url_configured": bool(invoice.payment_url_snapshot),
            "payment_instructions_configured": bool(invoice.payment_instructions_snapshot),
        },
        message=f"Payment instructions updated for invoice {invoice.invoice_number}",
        request=request,
    )
    db.commit()
    db.refresh(invoice)
    return _invoice_payment_read(invoice)
