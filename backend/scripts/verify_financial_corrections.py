from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialTransaction, Invoice, Payment
from app.services.accounting_sync import sync_operational_accounting
from app.services.activity_log import record_activity


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str
    organization: Org


def request(method: str, path: str) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def reversal_exists(db, organization_id: str, source_type: str, source_id: str) -> bool:
    original = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
        )
    )
    if original is None:
        return False
    return db.scalar(
        select(JournalEntry.id).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.reversed_entry_id == original.id,
        )
    ) is not None


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, o.name, m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(
        organization_id=str(row["organization_id"]),
        user_id=str(row["user_id"]),
        membership_id=str(row["membership_id"]),
        role="admin",
        organization=Org(
            id=str(row["organization_id"]),
            timezone=str(row["timezone"] or "UTC"),
            currency=str(row["currency"] or "BDT"),
            name=str(row["name"]),
        ),
    )

    db = SessionLocal()
    try:
        payment = db.scalar(
            select(Payment)
            .where(Payment.organization_id == tenant.organization_id, Payment.status == "confirmed")
            .order_by(Payment.created_at.desc())
        )
        expense = db.scalar(
            select(Expense)
            .where(Expense.organization_id == tenant.organization_id, Expense.status == "posted")
            .order_by(Expense.created_at.desc())
        )
        transfer = db.scalar(
            select(AccountTransfer)
            .where(AccountTransfer.organization_id == tenant.organization_id, AccountTransfer.status == "confirmed")
            .order_by(AccountTransfer.created_at.desc())
        )
        if payment is None or expense is None or transfer is None:
            raise AssertionError("correction verification requires payment, expense and transfer fixtures")

        sync_result = sync_operational_accounting(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            base_currency=tenant.organization.currency,
        )
        record_activity(
            db,
            action="accounting.correction_test.synced",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization",
            entity_id=tenant.organization_id,
            after={"sync_counts": sync_result.get("counts", sync_result)},
            message="Prepared accounting journals for correction verification",
            request=request("POST", "/accounting/sync"),
        )
        db.commit()

        invoice = db.scalar(select(Invoice).where(Invoice.id == payment.invoice_id))
        if invoice is None:
            raise AssertionError("payment invoice missing")
        before_paid = Decimal(invoice.amount_paid)
        payment_amount = Decimal(payment.invoice_amount)
        payment_id = payment.id
        payment_number = payment.payment_number
        payment_account_id = payment.account_id

        reverse_business_transaction(
            CorrectionRequest(source_type="payment", source_id=payment_id, reason="CI correction verification", reversal_date=date(2099, 12, 20)),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        payment_after = db.scalar(select(Payment).where(Payment.id == payment_id))
        invoice_after = db.scalar(select(Invoice).where(Invoice.id == payment.invoice_id))
        if payment_after is None or payment_after.status != "reversed":
            raise AssertionError("payment reversal did not mark payment reversed")
        if invoice_after is None or Decimal(invoice_after.amount_paid) != max(Decimal("0"), before_paid - payment_amount):
            raise AssertionError("payment reversal did not restore invoice paid amount")
        payment_reversal_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.account_id == payment_account_id,
                FinancialTransaction.source_id == payment_id,
                FinancialTransaction.source_type.like("payment_reversal%"),
            )
        ) or 0
        if payment_reversal_count != 1:
            raise AssertionError(f"expected one payment financial reversal, found {payment_reversal_count}")
        if not reversal_exists(db, tenant.organization_id, "invoice_payment", payment_id):
            raise AssertionError(f"payment {payment_number} accounting journal was not reversed")

        expense_id = expense.id
        reverse_business_transaction(
            CorrectionRequest(source_type="expense", source_id=expense_id, reason="CI expense correction", reversal_date=date(2099, 12, 21)),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        expense_after = db.scalar(select(Expense).where(Expense.id == expense_id))
        if expense_after is None or expense_after.status != "voided" or expense_after.voided_at is None:
            raise AssertionError("expense reversal did not void the expense")
        expense_reversal_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == expense_id,
                FinancialTransaction.source_type.like("expense_reversal%"),
            )
        ) or 0
        if expense_reversal_count != 1:
            raise AssertionError(f"expected one expense financial reversal, found {expense_reversal_count}")
        if not reversal_exists(db, tenant.organization_id, "expense_post", expense_id):
            raise AssertionError("expense accounting journal was not reversed")

        transfer_id = transfer.id
        original_transfer_movements = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == transfer_id,
                FinancialTransaction.source_type.in_(["transfer", "transfer_fee"]),
            )
        ) or 0
        reverse_business_transaction(
            CorrectionRequest(source_type="transfer", source_id=transfer_id, reason="CI transfer correction", reversal_date=date(2099, 12, 22)),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        transfer_after = db.scalar(select(AccountTransfer).where(AccountTransfer.id == transfer_id))
        if transfer_after is None or transfer_after.status != "reversed":
            raise AssertionError("transfer reversal did not mark transfer reversed")
        transfer_reversal_count = db.scalar(
            select(func.count(FinancialTransaction.id)).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == transfer_id,
                FinancialTransaction.source_type.like("transfer_reversal%"),
            )
        ) or 0
        if transfer_reversal_count != original_transfer_movements:
            raise AssertionError(f"expected {original_transfer_movements} transfer reversal movements, found {transfer_reversal_count}")
        if not reversal_exists(db, tenant.organization_id, "account_transfer", transfer_id):
            raise AssertionError("transfer accounting journal was not reversed")

        print("financial correction verification passed: payment + expense + transfer operational and journal reversals")
    finally:
        db.close()


if __name__ == "__main__":
    main()
