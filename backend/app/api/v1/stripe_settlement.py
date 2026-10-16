"""Tenant-safe Stripe Sandbox fee reconciliation and accounting *preview*.

No real Invoice, Payment, FinancialTransaction or JournalEntry is created here.
Live-mode settlement posting must be implemented and approved separately.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from typing import Annotated

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.finance import Invoice, FinancialAccount
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_checkout import StripeCheckoutAttempt
from app.models.stripe_settlement import StripeSettlementSnapshot
from app.services.activity_log import record_activity
from app.services.payment_gateway_secrets import decrypt_gateway_secret
from app.services.stripe_settlement import verified_sandbox_settlement
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance/stripe-settlement", tags=["Stripe Settlement"])
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]


def _money(minor: int) -> str:
    return f"{Decimal(minor) / Decimal(100):.2f}"


def snapshot_read(row: StripeSettlementSnapshot, *, account_name: str) -> dict:
    return {
        "reconciled": True,
        "mode": "test", "currency": row.currency,
        "gross": _money(row.gross_minor),
        "processing_fee": _money(row.fee_minor),
        "net_stripe_balance": _money(row.net_minor),
        "stripe_charge_id": row.stripe_charge_id,
        "stripe_balance_transaction_id": row.stripe_balance_transaction_id,
        "availability_status": row.availability_status,
        "reconciled_at": row.reconciled_at,
        "financial_account": account_name,
        "accounting_posted": False,
        "payout_reconciled": False,
        "journal_preview": [
            {"debit": f"{account_name} (Stripe Clearing)", "credit": "Accounts Receivable", "amount": _money(row.gross_minor), "currency": row.currency},
            *([{"debit": "Bank & Processing Fees", "credit": f"{account_name} (Stripe Clearing)", "amount": _money(row.fee_minor), "currency": row.currency}] if row.fee_minor else []),
        ],
        "notice": "Sandbox reconciliation only: invoice, financial accounts, journal, ledger and reports are unchanged. Bank payout is a separate future transfer.",
    }


def _invoice(db: DbSession, organization_id: str, invoice_id: str) -> Invoice:
    result = db.scalar(select(Invoice).where(
        Invoice.id == invoice_id, Invoice.organization_id == organization_id,
    ))
    if result is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return result


def _attempt(db: DbSession, organization_id: str, invoice_id: str, attempt_id: str, *, lock: bool) -> StripeCheckoutAttempt:
    query = select(StripeCheckoutAttempt).where(
        StripeCheckoutAttempt.id == attempt_id,
        StripeCheckoutAttempt.invoice_id == invoice_id,
        StripeCheckoutAttempt.organization_id == organization_id,
        StripeCheckoutAttempt.mode == "test",
    )
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(status_code=404, detail="Stripe Sandbox session not found for this invoice")
    return row


def _receipt_account(db: DbSession, invoice: Invoice, connection: PaymentGatewayConnection) -> FinancialAccount:
    account = db.scalar(select(FinancialAccount).where(
        FinancialAccount.id == invoice.payment_account_id,
        FinancialAccount.organization_id == invoice.organization_id,
        FinancialAccount.gateway_connection_id == connection.id,
        FinancialAccount.account_type == "payment_gateway",
        FinancialAccount.currency == invoice.currency,
    ))
    if account is None:
        raise HTTPException(status_code=409, detail="Invoice receipt account no longer matches this Stripe connection")
    return account


@router.get("/invoices/{invoice_id}/attempts/{attempt_id}")
def read_settlement(invoice_id: str, attempt_id: str, db: DbSession, tenant: Viewer):
    invoice = _invoice(db, tenant.organization_id, invoice_id)
    attempt = _attempt(db, tenant.organization_id, invoice.id, attempt_id, lock=False)
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == attempt.connection_id,
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "test",
    ))
    if connection is None:
        raise HTTPException(status_code=404, detail="Stripe connection not found")
    snapshot = db.scalar(select(StripeSettlementSnapshot).where(
        StripeSettlementSnapshot.organization_id == tenant.organization_id,
        StripeSettlementSnapshot.attempt_id == attempt.id,
        StripeSettlementSnapshot.connection_id == connection.id,
    ))
    if snapshot is None:
        return {"reconciled": False, "accounting_posted": False, "reason": "Stripe settlement has not been verified"}
    account = _receipt_account(db, invoice, connection)
    return snapshot_read(snapshot, account_name=account.name)


@router.post("/invoices/{invoice_id}/attempts/{attempt_id}/reconcile")
def reconcile_stripe_sandbox(
    invoice_id: str, attempt_id: str, request: Request, db: DbSession, tenant: Manager,
):
    invoice = _invoice(db, tenant.organization_id, invoice_id)
    attempt = _attempt(db, tenant.organization_id, invoice.id, attempt_id, lock=True)
    if attempt.status != "sandbox_paid" or not attempt.stripe_payment_intent_id:
        raise HTTPException(status_code=409, detail="A verified paid Stripe Sandbox webhook is required first")
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == attempt.connection_id,
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "test",
        PaymentGatewayConnection.is_active.is_(True),
    ))
    if connection is None or connection.connection_method != "api_key" or not connection.secret_key_ciphertext:
        raise HTTPException(status_code=409, detail="The original Stripe Sandbox API connection is unavailable")
    account = _receipt_account(db, invoice, connection)
    previous = db.scalar(select(StripeSettlementSnapshot).where(
        StripeSettlementSnapshot.organization_id == tenant.organization_id,
        StripeSettlementSnapshot.attempt_id == attempt.id,
    ))
    if previous:
        return snapshot_read(previous, account_name=account.name)
    if attempt.currency != invoice.currency or attempt.currency != "USD":
        raise HTTPException(status_code=409, detail="Stripe settlement and Invoice currency must match")
    # Stripe API reads are performed while the attempt is locked. This prevents
    # two simultaneous requests creating duplicate fee/settlement snapshots.
    facts = verified_sandbox_settlement(
        api_key=decrypt_gateway_secret(connection.secret_key_ciphertext),
        payment_intent_id=attempt.stripe_payment_intent_id,
        currency=attempt.currency,
        amount_minor=attempt.amount_minor,
    )
    row = StripeSettlementSnapshot(
        organization_id=tenant.organization_id,
        attempt_id=attempt.id, connection_id=connection.id,
        stripe_payment_intent_id=facts.payment_intent_id,
        stripe_charge_id=facts.charge_id,
        stripe_balance_transaction_id=facts.balance_transaction_id,
        currency=facts.currency,
        gross_minor=facts.gross_minor, fee_minor=facts.fee_minor,
        net_minor=facts.net_minor, availability_status=facts.availability_status,
    )
    db.add(row)
    db.flush()
    record_activity(
        db, action="payment_gateway.stripe.sandbox_settlement_verified", scope="tenant",
        actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="stripe_settlement_snapshot", entity_id=row.id,
        after={
            "invoice_id": invoice.id, "checkout_attempt_id": attempt.id,
            "stripe_balance_transaction_id": facts.balance_transaction_id,
            "gross_minor": facts.gross_minor, "fee_minor": facts.fee_minor,
            "net_minor": facts.net_minor, "currency": facts.currency,
            "accounting_posted": False,
        },
        request=request,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This Stripe settlement is already recorded") from exc
    return snapshot_read(row, account_name=account.name)
