from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting_loans import AccountingLoanCreate, LoanAccountingRepaymentCreate, LoanDisbursementCreate, create_accounting_loan
from app.api.v1.finance import change_invoice_status, create_account, create_invoice_from_order
from app.api.v1.financial_safety import safe_disburse_loan, safe_pay_payable_bill, safe_record_payment, safe_repay_loan
from app.api.v1.payables import create_payable_bill
from app.db.session import SessionLocal, engine
from app.models.accounting import LedgerAccount
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.finance import Invoice, Payment
from app.models.loan_accounting import LoanDisbursement
from app.models.orders import Order
from app.models.payables import PayableBill, PayablePayment
from app.schemas.finance import FinancialAccountCreate, InvoiceStatusAction, PaymentCreate
from app.schemas.payables import PayableBillCreate, PayablePaymentCreate


@dataclass(frozen=True)
class FixtureOrganization:
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def make_request(method: str, path: str, idempotency_key: str | None = None) -> Request:
    headers = []
    if idempotency_key:
        headers.append((b"idempotency-key", idempotency_key.encode()))
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": headers, "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        if connection.execute(text("SELECT to_regclass('public.posting_idempotency')")).scalar_one() is None:
            raise AssertionError("posting_idempotency table is missing")

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(
            timezone=str(fixture["timezone"] or "UTC"),
            currency=str(fixture["currency"] or "USD"),
            name=str(fixture["name"]),
        ),
    )
    db = SessionLocal()
    try:
        active_invoiced_order_ids = select(Invoice.order_id).where(
            Invoice.organization_id == tenant.organization_id,
            Invoice.status != "cancelled",
            Invoice.order_id.is_not(None),
        )
        order = db.scalar(
            select(Order)
            .where(
                Order.organization_id == tenant.organization_id,
                Order.status != "cancelled",
                Order.id.not_in(active_invoiced_order_ids),
            )
            .order_by(Order.created_at.desc())
        )
        if order is None:
            raise AssertionError("idempotency verification requires an uninvoiced order fixture")

        suffix = uuid4().hex[:8]
        account = create_account(
            FinancialAccountCreate(
                name=f"CI Idempotency Bank {suffix}",
                account_type="bank",
                currency=order.currency,
                opening_balance=Decimal("1000"),
            ),
            make_request("POST", "/api/v1/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )

        # This fixture intentionally exercises a foreign-currency operational flow
        # (the seeded order is USD while the Existing Tenant Fixture is BDT). A valid
        # organization FX rate is part of the accounting precondition; idempotency
        # should not depend on the former behavior of silently treating USD as BDT.
        # Fixture setup uses raw SQL, like the migration fixture seed, so the runtime
        # audit guard remains strict for all application ORM writes.
        account_currency = account.currency.upper()
        base_currency = tenant.organization.currency.upper()
        if account_currency != base_currency:
            with engine.begin() as connection:
                rate_exists = connection.execute(
                    text("""
                        SELECT 1
                        FROM organization_exchange_rates
                        WHERE organization_id = :organization_id
                          AND (
                              (base_currency = :account_currency AND quote_currency = :base_currency)
                              OR
                              (base_currency = :base_currency AND quote_currency = :account_currency)
                          )
                        LIMIT 1
                    """),
                    {
                        "organization_id": tenant.organization_id,
                        "account_currency": account_currency,
                        "base_currency": base_currency,
                    },
                ).scalar()
                if rate_exists is None:
                    fixture_rate = Decimal("120.00000000")
                    connection.execute(
                        text("""
                            INSERT INTO organization_exchange_rates
                                (id, organization_id, base_currency, quote_currency,
                                 reference_rate, manual_rate, effective_rate, source,
                                 synced_at, created_at, updated_at)
                            VALUES
                                (:id, :organization_id, :account_currency, :base_currency,
                                 :rate, :rate, :rate, 'ci_financial_idempotency',
                                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """),
                        {
                            "id": str(uuid4()),
                            "organization_id": tenant.organization_id,
                            "account_currency": account_currency,
                            "base_currency": base_currency,
                            "rate": fixture_rate,
                        },
                    )

        invoice = create_invoice_from_order(
            order.id, make_request("POST", f"/api/v1/finance/invoices/from-order/{order.id}"), db, tenant,  # type: ignore[arg-type]
        )
        sent = change_invoice_status(
            invoice.id,
            InvoiceStatusAction(action="send"),
            make_request("PATCH", f"/api/v1/finance/invoices/{invoice.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        payment_amount = min(Decimal("1.00"), Decimal(sent.balance_due))
        payment_payload = PaymentCreate(
            invoice_id=sent.id,
            account_id=account.id,
            invoice_amount=payment_amount,
            method="bank_transfer",
            reference=f"CI-IDEM-{suffix}",
        )
        payment_key = f"ci-payment-{suffix}"
        first_payment = safe_record_payment(
            payment_payload,
            make_request("POST", "/api/v1/finance/payments", payment_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        second_payment = safe_record_payment(
            payment_payload,
            make_request("POST", "/api/v1/finance/payments", payment_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if first_payment.id != second_payment.id:
            raise AssertionError("replayed invoice payment created a second resource")
        payment_count = db.scalar(
            select(func.count(Payment.id)).where(
                Payment.organization_id == tenant.organization_id,
                Payment.invoice_id == sent.id,
                Payment.reference == payment_payload.reference,
            )
        )
        if payment_count != 1:
            raise AssertionError(f"expected one idempotent invoice payment, found {payment_count}")
        db.expire_all()
        persisted_invoice = db.scalar(select(Invoice).where(Invoice.id == sent.id))
        if persisted_invoice is None or Decimal(persisted_invoice.amount_paid) != payment_amount:
            raise AssertionError("replayed invoice payment changed invoice balance twice")

        expense_account = db.scalar(
            select(LedgerAccount).where(
                LedgerAccount.organization_id == tenant.organization_id,
                LedgerAccount.category == "expense",
                LedgerAccount.is_active.is_(True),
            ).order_by(LedgerAccount.created_at.asc())
        )
        if expense_account is None:
            raise AssertionError("idempotency verification requires an active expense ledger account")

        bill = create_payable_bill(
            PayableBillCreate(
                supplier_name=f"CI Supplier {suffix}",
                bill_date=date(2098, 1, 5),
                due_date=date(2098, 1, 31),
                currency=account.currency,
                amount=Decimal("25"),
                expense_ledger_account_id=expense_account.id,
                description="CI idempotent payable bill",
                reference=f"CI-BILL-{suffix}",
            ),
            make_request("POST", "/api/v1/accounting/payables"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        payable_payload = PayablePaymentCreate(
            financial_account_id=account.id,
            payment_date=date(2098, 1, 10),
            amount=Decimal("10"),
            reference=f"CI-PAYABLE-{suffix}",
        )
        payable_key = f"ci-payable-{suffix}"
        first_payable = safe_pay_payable_bill(
            bill.id,
            payable_payload,
            make_request("POST", f"/api/v1/accounting/payables/{bill.id}/payments", payable_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        second_payable = safe_pay_payable_bill(
            bill.id,
            payable_payload,
            make_request("POST", f"/api/v1/accounting/payables/{bill.id}/payments", payable_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if first_payable.id != second_payable.id:
            raise AssertionError("replayed payable payment created a second resource")
        payable_count = db.scalar(
            select(func.count(PayablePayment.id)).where(
                PayablePayment.organization_id == tenant.organization_id,
                PayablePayment.bill_id == bill.id,
                PayablePayment.reference == payable_payload.reference,
            )
        )
        if payable_count != 1:
            raise AssertionError(f"expected one idempotent payable payment, found {payable_count}")
        db.expire_all()
        persisted_bill = db.scalar(select(PayableBill).where(PayableBill.id == bill.id))
        if persisted_bill is None or Decimal(persisted_bill.amount_paid) != Decimal("10.00"):
            raise AssertionError("replayed payable payment changed supplier balance twice")

        loan = create_accounting_loan(
            AccountingLoanCreate(
                lender_name=f"CI Lender {suffix}",
                lender_type="bank",
                currency=account.currency,
                approved_amount=Decimal("100"),
                annual_interest_rate=Decimal("5"),
                approval_date=date(2098, 2, 1),
                reference=f"CI-LOAN-{suffix}",
            ),
            make_request("POST", "/api/v1/accounting/loans"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        disbursement_payload = LoanDisbursementCreate(
            account_id=account.id,
            disbursement_date=date(2098, 2, 2),
            principal_amount=Decimal("100"),
            fee_withheld_amount=Decimal("2"),
            reference=f"CI-DISB-{suffix}",
        )
        disbursement_key = f"ci-disburse-{suffix}"
        first_disbursement = safe_disburse_loan(
            loan["id"],
            disbursement_payload,
            make_request("POST", f"/api/v1/accounting/loans/{loan['id']}/disburse", disbursement_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        second_disbursement = safe_disburse_loan(
            loan["id"],
            disbursement_payload,
            make_request("POST", f"/api/v1/accounting/loans/{loan['id']}/disburse", disbursement_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if first_disbursement["id"] != second_disbursement["id"]:
            raise AssertionError("replayed loan disbursement created a second resource")
        disbursement_count = db.scalar(
            select(func.count(LoanDisbursement.id)).where(
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.loan_id == loan["id"],
                LoanDisbursement.reference == disbursement_payload.reference,
            )
        )
        if disbursement_count != 1:
            raise AssertionError(f"expected one idempotent loan disbursement, found {disbursement_count}")
        db.expire_all()
        persisted_loan = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan["id"]))
        if persisted_loan is None or Decimal(persisted_loan.outstanding_principal) != Decimal("100.00"):
            raise AssertionError("replayed loan disbursement increased principal twice")

        repayment_payload = LoanAccountingRepaymentCreate(
            account_id=account.id,
            payment_date=date(2098, 2, 15),
            principal_amount=Decimal("10"),
            interest_amount=Decimal("1"),
            fee_amount=Decimal("0.50"),
            fee_type="processing_fee",
            reference=f"CI-REPAY-{suffix}",
        )
        repayment_key = f"ci-repay-{suffix}"
        first_repayment = safe_repay_loan(
            loan["id"],
            repayment_payload,
            make_request("POST", f"/api/v1/accounting/loans/{loan['id']}/repay", repayment_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        second_repayment = safe_repay_loan(
            loan["id"],
            repayment_payload,
            make_request("POST", f"/api/v1/accounting/loans/{loan['id']}/repay", repayment_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if first_repayment["id"] != second_repayment["id"]:
            raise AssertionError("replayed loan repayment created a second resource")
        repayment_count = db.scalar(
            select(func.count(LoanRepayment.id)).where(
                LoanRepayment.organization_id == tenant.organization_id,
                LoanRepayment.loan_id == loan["id"],
                LoanRepayment.reference == repayment_payload.reference,
            )
        )
        if repayment_count != 1:
            raise AssertionError(f"expected one idempotent loan repayment, found {repayment_count}")
        db.expire_all()
        persisted_loan = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan["id"]))
        if persisted_loan is None or Decimal(persisted_loan.outstanding_principal) != Decimal("90.00"):
            raise AssertionError("replayed loan repayment reduced principal twice")
    finally:
        db.close()

    print("financial idempotency verification passed: invoice payment, payable payment, loan disbursement, loan repayment")


if __name__ == "__main__":
    main()
