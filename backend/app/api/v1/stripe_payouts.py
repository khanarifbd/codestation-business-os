"""Bank-evidence-gated, Stripe-verified Live Payout reconciliation.

Payouts are one transfer from Stripe Clearing to a same-currency Bank account,
never a second revenue. Only live Stripe payouts with bank statement evidence
may be booked. No route handles/test-posts simulated Sandbox payouts.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.finance_transfers import record_transfer
from app.db.session import defer_commits
from app.models.finance import AccountTransfer, FinancialAccount
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_payout import StripePayoutReconciliation
from app.schemas.finance import AccountTransferCreate
from app.services.activity_log import record_activity
from app.services.operational_posting import post_transfer
from app.services.payment_gateway_secrets import decrypt_gateway_secret
from app.services.stripe_settlement import stripe_retrieve
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance/stripe-payouts", tags=["Stripe Payouts"])
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]


class PayoutConfirm(BaseModel):
    stripe_payout_id: str = Field(pattern=r"^po_[A-Za-z0-9]{8,110}$")
    source_account_id: str
    bank_account_id: str
    bank_statement_reference: str = Field(min_length=6, max_length=180)


def _as_json(row: StripePayoutReconciliation) -> dict:
    return {
        "id": row.id, "stripe_payout_id": row.stripe_payout_id,
        "transfer_id": row.transfer_id, "currency": row.currency,
        "amount": f"{Decimal(row.amount_minor) / 100:.2f}",
        "source_account_id": row.stripe_account_id,
        "bank_account_id": row.bank_account_id,
        "bank_statement_reference": row.bank_statement_reference,
        "reconciled_at": row.reconciled_at,
        "accounting_posted": True,
        "income_recognized": False,
    }


@router.get("")
def list_payouts(db: DbSession, tenant: Viewer, limit: int = 50):
    rows = db.scalars(select(StripePayoutReconciliation).where(
        StripePayoutReconciliation.organization_id == tenant.organization_id,
    ).order_by(StripePayoutReconciliation.reconciled_at.desc()).limit(max(1, min(limit, 100)))).all()
    return [_as_json(row) for row in rows]


@router.post("/reconcile")
def confirm_live_payout(payload: PayoutConfirm, request: Request, db: DbSession, tenant: Manager):
    if payload.source_account_id == payload.bank_account_id:
        raise HTTPException(status_code=400, detail="Payout must move between two different accounts")
    reference = payload.bank_statement_reference.strip()
    if len(reference) < 6:
        raise HTTPException(status_code=422, detail="Bank statement reference is required")

    # Lock the gateway connection first to serialize this payout across requests.
    source_account = db.scalar(select(FinancialAccount).where(
        FinancialAccount.id == payload.source_account_id,
        FinancialAccount.organization_id == tenant.organization_id,
        FinancialAccount.account_type == "payment_gateway",
        FinancialAccount.is_active.is_(True),
    ))
    if source_account is None or source_account.gateway_connection_id is None:
        raise HTTPException(status_code=404, detail="Connected Stripe Clearing account not found")
    connection = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == source_account.gateway_connection_id,
        PaymentGatewayConnection.organization_id == tenant.organization_id,
        PaymentGatewayConnection.provider == "stripe",
        PaymentGatewayConnection.mode == "live",
        PaymentGatewayConnection.is_active.is_(True),
    ).with_for_update())
    if connection is None or connection.connection_method != "api_key" or not connection.secret_key_ciphertext:
        raise HTTPException(status_code=409, detail="Active Stripe Live API key is required to verify payout")

    previous = db.scalar(select(StripePayoutReconciliation).where(
        StripePayoutReconciliation.organization_id == tenant.organization_id,
        StripePayoutReconciliation.connection_id == connection.id,
        StripePayoutReconciliation.stripe_payout_id == payload.stripe_payout_id,
    ))
    if previous:
        if (previous.stripe_account_id != payload.source_account_id
                or previous.bank_account_id != payload.bank_account_id
                or previous.bank_statement_reference != reference):
            raise HTTPException(status_code=409, detail="Stripe payout was already reconciled with different bank details")
        linked_transfer = db.scalar(select(AccountTransfer).where(
            AccountTransfer.id == previous.transfer_id,
            AccountTransfer.organization_id == tenant.organization_id,
        ))
        if linked_transfer is None or linked_transfer.status != "confirmed":
            raise HTTPException(status_code=409, detail="Previously reconciled Stripe payout transfer requires accounting review")
        return _as_json(previous)

    # A legacy or manually recorded transfer may already have settled this payout.
    # Do not create a second transfer just because no Stripe linkage row exists.
    manually_recorded = db.scalar(select(AccountTransfer.id).where(
        AccountTransfer.organization_id == tenant.organization_id,
        AccountTransfer.from_account_id == payload.source_account_id,
        AccountTransfer.reference == payload.stripe_payout_id,
        AccountTransfer.status == "confirmed",
    ))
    if manually_recorded is not None:
        raise HTTPException(status_code=409, detail="A transfer with this Stripe payout reference already exists; review and reconcile it manually")

    bank = db.scalar(select(FinancialAccount).where(
        FinancialAccount.id == payload.bank_account_id,
        FinancialAccount.organization_id == tenant.organization_id,
        FinancialAccount.is_active.is_(True),
        FinancialAccount.account_type == "bank",
    ))
    if bank is None:
        raise HTTPException(status_code=404, detail="Destination Bank financial account not found")
    if source_account.currency != bank.currency or source_account.currency != "USD":
        raise HTTPException(status_code=409, detail="Only USD-to-USD payout is supported; cross-currency bank settlement needs verified FX details")
    if not connection.payouts_enabled:
        raise HTTPException(status_code=409, detail="Live Stripe payouts are not enabled for this gateway")
    payout = stripe_retrieve(
        decrypt_gateway_secret(connection.secret_key_ciphertext), "payout", payload.stripe_payout_id,
    )
    amount_minor = payout.get("amount")
    if (payout.get("livemode") is not True or payout.get("status") != "paid"
            or payout.get("currency") != source_account.currency.lower()
            or not isinstance(amount_minor, int) or isinstance(amount_minor, bool)
            or amount_minor <= 0):
        raise HTTPException(status_code=409, detail="Stripe payout is not a verified paid USD Live payout")
    # Stripe's status "paid" cannot itself prove the bank received funds:
    # tenant accountant must provide the corresponding statement reference.
    amount = Decimal(amount_minor) / Decimal(100)
    with defer_commits(db):
        result = record_transfer(
            AccountTransferCreate(
                from_account_id=source_account.id, to_account_id=bank.id,
                source_amount=amount, fee_amount=Decimal("0"),
                destination_amount=amount,
                reference=payload.stripe_payout_id,
                notes=f"Stripe Live payout confirmed on bank statement: {reference}",
            ),
            request, db, tenant,
        )
        transfer = db.scalar(select(AccountTransfer).where(
            AccountTransfer.id == result.id,
            AccountTransfer.organization_id == tenant.organization_id,
        ))
        if transfer is None:
            raise HTTPException(status_code=409, detail="Stripe bank transfer was not persisted")
        post_transfer(db, organization_id=tenant.organization_id, user_id=tenant.user_id, transfer=transfer)
        row = StripePayoutReconciliation(
            organization_id=tenant.organization_id,
            connection_id=connection.id, stripe_payout_id=payload.stripe_payout_id,
            transfer_id=transfer.id,
            stripe_account_id=source_account.id, bank_account_id=bank.id,
            currency="USD", amount_minor=amount_minor,
            bank_statement_reference=reference,
        )
        db.add(row)
        db.flush()
        record_activity(
            db, action="stripe.live_payout_bank_reconciled", scope="tenant",
            organization_id=tenant.organization_id, actor_user_id=tenant.user_id,
            entity_type="stripe_payout_reconciliation", entity_id=row.id,
            after={
                "stripe_payout_id": payout["id"], "transfer_id": transfer.id,
                "source_account_id": source_account.id, "bank_account_id": bank.id,
                "currency": "USD", "amount_minor": amount_minor,
                "bank_statement_reference": reference,
                "income_recognized": False,
            }, request=request,
        )
    db.commit()
    return _as_json(row)
