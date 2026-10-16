"""Atomic Stripe settlement accounting using Business OS's established ledger.

Only trusted, previously verified *live* settlements may reach this service.
No public route currently calls this function: a live signed-webhook plus
refund/dispute/payout lifecycle must be completed before enabling live posting.
Sandbox transactions always fail closed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, Request
from sqlalchemy import select

from app.api.v1.finance import record_payment
from app.db.session import defer_commits
from app.models.accounting import JournalEntry
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.models.payment_gateways import PaymentGatewayConnection
from app.models.stripe_accounting import StripeAccountingPosting
from app.models.stripe_checkout import StripeCheckoutAttempt
from app.models.stripe_settlement import StripeSettlementSnapshot
from app.schemas.finance import PaymentCreate
from app.services.accounting_posting import (
    PostingLine, financial_ledger_account, money, post_journal, system_account, to_base_amount,
)
from app.services.activity_log import record_activity
from app.services.operational_posting import post_invoice_payment
from app.services.functional_currency import functional_currency_for_date
from app.tenancy.context import TenantContext


def post_verified_live_stripe_settlement(
    db,
    *, organization_id: str, actor: TenantContext,
    snapshot_id: str, request: Request,
) -> StripeAccountingPosting:
    """Create payment, fee movement, journals, audit and idempotent link atomically.

    This function is intentionally not an HTTP endpoint or background worker.
    Only a future verified live webhook flow may invoke it. An authenticated
    tenant operator alone is not sufficient to authorize Stripe payment truth.
    """
    if actor.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Organization context mismatch")
    with defer_commits(db):
        snapshot = db.scalar(select(StripeSettlementSnapshot).where(
            StripeSettlementSnapshot.organization_id == organization_id,
            StripeSettlementSnapshot.id == snapshot_id,
        ).with_for_update())
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Verified Stripe settlement not found")
        prior = db.scalar(select(StripeAccountingPosting).where(
            StripeAccountingPosting.organization_id == organization_id,
            StripeAccountingPosting.snapshot_id == snapshot.id,
        ))
        if prior is not None:
            return prior

        attempt = db.scalar(select(StripeCheckoutAttempt).where(
            StripeCheckoutAttempt.organization_id == organization_id,
            StripeCheckoutAttempt.id == snapshot.attempt_id,
            StripeCheckoutAttempt.connection_id == snapshot.connection_id,
        ).with_for_update())
        # A Sandbox invoice is never a real cash receipt, even for an organization
        # that uses testing data for its existing finance records.
        if attempt is None or attempt.mode != "live" or attempt.status != "live_paid":
            raise HTTPException(status_code=409, detail="Only verified LIVE Stripe settlements can be posted")
        connection = db.scalar(select(PaymentGatewayConnection).where(
            PaymentGatewayConnection.organization_id == organization_id,
            PaymentGatewayConnection.id == attempt.connection_id,
            PaymentGatewayConnection.provider == "stripe",
            PaymentGatewayConnection.mode == "live",
            PaymentGatewayConnection.is_active.is_(True),
        ))
        if connection is None:
            raise HTTPException(status_code=409, detail="Active Live Stripe connection not found")
        if (snapshot.stripe_payment_intent_id != attempt.stripe_payment_intent_id
                or snapshot.currency != "USD" or snapshot.currency != attempt.currency
                or snapshot.gross_minor != attempt.amount_minor
                or snapshot.gross_minor <= 0 or snapshot.fee_minor < 0
                or snapshot.net_minor < 0
                or snapshot.gross_minor != snapshot.fee_minor + snapshot.net_minor):
            raise HTTPException(status_code=409, detail="Stripe settlement identity or amount differs from Checkout")

        invoice = db.scalar(select(Invoice).where(
            Invoice.organization_id == organization_id,
            Invoice.id == attempt.invoice_id,
        ).with_for_update())
        if invoice is None or invoice.status not in {"sent", "partially_paid"}:
            raise HTTPException(status_code=409, detail="Invoice is not currently payable")
        gross = money(Decimal(snapshot.gross_minor) / 100)
        fee = money(Decimal(snapshot.fee_minor) / 100)
        if (invoice.currency != snapshot.currency or Decimal(invoice.balance_due) < gross
                or invoice.payment_method != "stripe"):
            raise HTTPException(status_code=409, detail="Invoice currency, balance or payment method does not match Stripe")
        account = db.scalar(select(FinancialAccount).where(
            FinancialAccount.organization_id == organization_id,
            FinancialAccount.id == invoice.payment_account_id,
            FinancialAccount.gateway_connection_id == connection.id,
            FinancialAccount.account_type == "payment_gateway",
            FinancialAccount.is_active.is_(True),
            FinancialAccount.currency == snapshot.currency,
        ).with_for_update())
        if account is None:
            raise HTTPException(status_code=409, detail="Invoice clearing account does not match Live Stripe gateway")

        # The invoice/Payment model, AR journal and operational account credit
        # are produced by established Business OS functions, not parallel math.
        payload = PaymentCreate(
            invoice_id=invoice.id, account_id=account.id,
            invoice_amount=gross, account_amount=gross,
            exchange_rate=Decimal("1"),
            method="stripe",
            reference=snapshot.stripe_payment_intent_id,
            notes="Verified Stripe gross payment; gateway fee booked separately",
        )
        result = record_payment(payload, request, db, actor)
        payment = db.scalar(select(Payment).where(
            Payment.organization_id == organization_id, Payment.id == result.id,
        ))
        if payment is None:
            raise HTTPException(status_code=409, detail="Stripe payment record could not be loaded")
        post_invoice_payment(
            db, organization_id=organization_id, user_id=actor.user_id, payment=payment,
        )

        fee_journal_id = None
        if fee > 0:
            _, clearing = financial_ledger_account(db, organization_id, account.id)
            expense = system_account(db, organization_id, "bank_fees")
            base = functional_currency_for_date(db, organization_id, payment.payment_date)
            fee_base, rate = to_base_amount(
                db, organization_id, base, fee, account.currency, rate_date=payment.payment_date,
            )
            journal = post_journal(
                db, organization_id=organization_id, user_id=actor.user_id,
                entry_date=payment.payment_date,
                source_type="stripe_processing_fee", source_id=snapshot.id,
                reference=snapshot.stripe_balance_transaction_id,
                memo=f"Stripe processing fee for {invoice.invoice_number}",
                lines=[
                    PostingLine(
                        ledger_account_id=expense.id, debit=fee_base,
                        currency=account.currency, exchange_rate_to_base=rate,
                        original_amount=fee, description="Stripe processing fee",
                    ),
                    PostingLine(
                        ledger_account_id=clearing.id, credit=fee_base,
                        currency=account.currency, exchange_rate_to_base=rate,
                        original_amount=fee, description="Stripe clearing fee deduction",
                    ),
                ],
            )
            fee_journal_id = journal.id
            db.add(FinancialTransaction(
                organization_id=organization_id, account_id=account.id,
                transaction_date=payment.payment_date, direction="debit",
                amount=fee, currency=account.currency,
                source_type="stripe_processing_fee", source_id=snapshot.id,
                reference=snapshot.stripe_balance_transaction_id,
                description=f"Stripe processing fee for invoice {invoice.invoice_number}",
                created_by_user_id=actor.user_id,
            ))
        link = StripeAccountingPosting(
            organization_id=organization_id, snapshot_id=snapshot.id,
            payment_id=payment.id, fee_journal_entry_id=fee_journal_id,
        )
        db.add(link)
        db.flush()
        record_activity(
            db, action="stripe.live_accounting_posted", scope="tenant",
            actor_user_id=actor.user_id, organization_id=organization_id,
            entity_type="stripe_accounting_posting", entity_id=link.id,
            after={
                "invoice_id": invoice.id, "payment_id": payment.id,
                "settlement_id": snapshot.id, "fee_journal_id": fee_journal_id,
                "gross_minor": snapshot.gross_minor, "fee_minor": snapshot.fee_minor,
                "net_minor": snapshot.net_minor, "currency": snapshot.currency,
            }, request=request,
        )
    db.commit()
    return link
