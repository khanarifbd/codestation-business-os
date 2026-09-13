from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

import app.api.v1.accounting as accounting_api
import app.api.v1.accounting_reports as accounting_reports_api
from app.api.v1.accounting import create_manual_journal, update_ledger_account
from app.api.v1.finance import change_invoice_status, create_account, create_invoice, record_payment
from app.api.v1.organizations import create_organization
from app.api.v1.payables import create_payable_bill, pay_payable_bill
from app.db.session import SessionLocal
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.company_defaults import OrganizationExchangeRate
from app.models.crm import Client
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.organization import Organization
from app.models.user import User
from app.schemas.accounting import JournalEntryCreate, JournalLineCreate, LedgerAccountUpdate
from app.schemas.finance import FinancialAccountCreate, InvoiceCreate, InvoiceItemInput, InvoiceStatusAction, PaymentCreate
from app.schemas.organization import OrganizationCreate
from app.schemas.payables import PayableBillCreate, PayablePaymentCreate
from app.services.accounting_posting import financial_ledger_account, money, system_account, to_base_amount
from app.services.accounting_sync import sync_operational_accounting
from app.services.activity_log import record_activity
from app.services.exchange_rates import record_rate_snapshot


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: Organization


def req(method: str, path: str) -> Request:
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


def expect_409(fn, label: str) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != 409:
            raise AssertionError(f"{label}: expected HTTP 409, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"{label}: expected HTTP 409")


def entry_lines(db, organization_id: str, source_type: str, source_id: str):
    entry = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )
    if entry is None:
        raise AssertionError(f"Missing journal {source_type}/{source_id}")
    rows = db.execute(
        select(JournalLine, LedgerAccount.system_key)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(
            JournalLine.organization_id == organization_id,
            JournalLine.journal_entry_id == entry.id,
            LedgerAccount.organization_id == organization_id,
        )
    ).all()
    return entry, {system_key: line for line, system_key in rows}


def main() -> None:
    db = SessionLocal()
    marker = uuid4().hex[:10]
    try:
        user = db.scalar(select(User).order_by(User.created_at.asc()))
        if user is None:
            raise AssertionError("V1 accounting integrity verification requires a user")

        created = create_organization(
            OrganizationCreate(
                name=f"V1 Accounting Integrity {marker}",
                country_code="BD",
                timezone="Asia/Dhaka",
                currency="BDT",
                business_type="Software & IT Services",
                team_size="1-5",
                financial_year_start_month=1,
            ),
            req("POST", "/organizations"),
            db,
            user,
        )
        organization = db.get(Organization, created.organization.id)
        if organization is None:
            raise AssertionError("Integrity organization was not created")
        tenant = FixtureTenant(organization_id=organization.id, user_id=user.id, organization=organization)

        business_today = accounting_api.organization_local_date(organization)
        invoice_date = business_today - timedelta(days=2)
        settlement_date = business_today - timedelta(days=1)
        old_missing_date = business_today - timedelta(days=5)

        current_pair = OrganizationExchangeRate(
            organization_id=organization.id,
            base_currency="USD",
            quote_currency="BDT",
            reference_rate=Decimal("130.0000000000"),
            manual_rate=Decimal("130.0000000000"),
            effective_rate=Decimal("130.0000000000"),
            source="verification_current_rate",
        )
        db.add(current_pair)
        db.flush()
        invoice_snapshot = record_rate_snapshot(
            db,
            organization_id=organization.id,
            base_currency="USD",
            quote_currency="BDT",
            effective_date=invoice_date,
            reference_rate=Decimal("120"),
            effective_rate=Decimal("120"),
            source="verification_historical",
            user_id=user.id,
        )
        settlement_snapshot = record_rate_snapshot(
            db,
            organization_id=organization.id,
            base_currency="USD",
            quote_currency="BDT",
            effective_date=settlement_date,
            reference_rate=Decimal("125"),
            effective_rate=Decimal("125"),
            source="verification_historical",
            user_id=user.id,
        )
        record_activity(
            db,
            action="verification.v1_accounting.fx_seeded",
            scope="tenant",
            actor_user_id=user.id,
            organization_id=organization.id,
            entity_type="organization_exchange_rate",
            entity_id=current_pair.id,
            after={
                "current_rate": "130",
                "invoice_snapshot_id": invoice_snapshot.id,
                "invoice_rate": "120",
                "settlement_snapshot_id": settlement_snapshot.id,
                "settlement_rate": "125",
            },
            message="Seeded audited FX fixtures for V1 accounting integrity verification",
        )
        db.commit()

        invoice_base, invoice_rate = to_base_amount(
            db, organization.id, "BDT", Decimal("100"), "USD", rate_date=invoice_date
        )
        settlement_base, settlement_rate = to_base_amount(
            db, organization.id, "BDT", Decimal("100"), "USD", rate_date=settlement_date
        )
        if invoice_base != Decimal("12000.00") or invoice_rate != Decimal("120.00000000"):
            raise AssertionError("Historical invoice-date FX did not resolve to 120")
        if settlement_base != Decimal("12500.00") or settlement_rate != Decimal("125.00000000"):
            raise AssertionError("Historical settlement-date FX did not resolve to 125")
        if Decimal(current_pair.effective_rate) != Decimal("130.0000000000"):
            raise AssertionError("Current FX pair was unexpectedly rewritten by history")
        expect_409(
            lambda: to_base_amount(db, organization.id, "BDT", Decimal("1"), "USD", rate_date=old_missing_date),
            "missing historical FX",
        )

        client = Client(
            organization_id=organization.id,
            client_code=f"CLI-{marker}",
            client_type="company",
            display_name="Historical FX Customer",
            currency="USD",
            status="active",
        )
        db.add(client)
        db.flush()
        record_activity(
            db,
            action="verification.v1_accounting.client_seeded",
            scope="tenant",
            actor_user_id=user.id,
            organization_id=organization.id,
            entity_type="client",
            entity_id=client.id,
            after={"currency": client.currency, "display_name": client.display_name},
            message="Seeded client for V1 accounting integrity verification",
        )
        db.commit()
        db.refresh(client)

        bdt_bank = create_account(
            FinancialAccountCreate(name=f"BDT Settlement Bank {marker}", account_type="bank", currency="BDT"),
            req("POST", "/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )
        usd_bank = create_account(
            FinancialAccountCreate(
                name=f"USD Payables Bank {marker}",
                account_type="bank",
                currency="USD",
                opening_balance=Decimal("1000"),
            ),
            req("POST", "/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )

        invoice = create_invoice(
            InvoiceCreate(
                client_id=client.id,
                subject="Historical FX service",
                issue_date=invoice_date,
                currency="USD",
                items=[
                    InvoiceItemInput(
                        item_name="Consulting",
                        description="Consulting service",
                        quantity=Decimal("1"),
                        unit_price=Decimal("100"),
                    )
                ],
            ),
            req("POST", "/finance/invoices"), db, tenant,  # type: ignore[arg-type]
        )
        sent = change_invoice_status(
            invoice.id,
            InvoiceStatusAction(action="send"),
            req("PATCH", f"/finance/invoices/{invoice.id}/status"), db, tenant,  # type: ignore[arg-type]
        )
        payment = record_payment(
            PaymentCreate(
                invoice_id=sent.id,
                account_id=bdt_bank.id,
                payment_date=settlement_date,
                invoice_amount=Decimal("100"),
                account_amount=Decimal("12500"),
                method="bank_transfer",
                reference=f"FX-AR-{marker}",
            ),
            req("POST", "/finance/payments"), db, tenant,  # type: ignore[arg-type]
        )

        sync_result = sync_operational_accounting(
            db,
            organization_id=organization.id,
            user_id=user.id,
            base_currency="BDT",
            through_date=business_today,
        )
        if sync_result["errors"]:
            raise AssertionError(f"Operational accounting sync failed: {sync_result['errors']}")
        record_activity(
            db,
            action="verification.v1_accounting.sync_completed",
            scope="tenant",
            actor_user_id=user.id,
            organization_id=organization.id,
            entity_type="organization",
            entity_id=organization.id,
            after=sync_result,
            message="Synchronized operational records for V1 accounting integrity verification",
        )
        db.commit()

        issue_entry, issue_lines = entry_lines(db, organization.id, "invoice_issue", sent.id)
        if issue_entry.functional_currency != "BDT":
            raise AssertionError("Invoice functional currency is not BDT")
        if Decimal(issue_lines["accounts_receivable"].debit) != Decimal("12000.00"):
            raise AssertionError("Invoice receivable did not retain invoice-date carrying value")

        _, payment_lines = entry_lines(db, organization.id, "invoice_payment", payment.id)
        cash_key = f"financial_account:{bdt_bank.id}"
        if Decimal(payment_lines[cash_key].debit) != Decimal("12500.00"):
            raise AssertionError("Customer settlement cash did not use settlement-date value")
        if Decimal(payment_lines["accounts_receivable"].credit) != Decimal("12000.00"):
            raise AssertionError("Customer settlement cleared AR at its carrying amount")
        if Decimal(payment_lines["realized_fx_gain"].credit) != Decimal("500.00"):
            raise AssertionError("Customer settlement did not recognize BDT 500 realized FX gain")
        payment_debit = sum((Decimal(line.debit) for line in payment_lines.values()), Decimal("0"))
        payment_credit = sum((Decimal(line.credit) for line in payment_lines.values()), Decimal("0"))
        if payment_debit != payment_credit:
            raise AssertionError("Customer realized-FX journal is not balanced")

        bdt_account = db.get(FinancialAccount, bdt_bank.id)
        if bdt_account is None:
            raise AssertionError("BDT settlement account missing")
        _, bdt_ledger = financial_ledger_account(db, organization.id, bdt_bank.id)
        if bdt_ledger.allow_manual_posting:
            raise AssertionError("Mapped financial account ledger still allows manual posting")

        transaction_rows = db.execute(
            select(FinancialTransaction.direction, FinancialTransaction.amount).where(
                FinancialTransaction.organization_id == organization.id,
                FinancialTransaction.account_id == bdt_account.id,
            )
        ).all()
        operational_balance = Decimal(bdt_account.opening_balance) + sum(
            (Decimal(amount) if direction == "credit" else -Decimal(amount) for direction, amount in transaction_rows),
            Decimal("0"),
        )
        gl_balance = Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0))
                .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
                .where(
                    JournalLine.organization_id == organization.id,
                    JournalLine.ledger_account_id == bdt_ledger.id,
                    JournalEntry.organization_id == organization.id,
                    JournalEntry.status == "posted",
                )
            ) or 0
        )
        if money(operational_balance) != money(gl_balance) or money(gl_balance) != Decimal("12500.00"):
            raise AssertionError(f"Financial account and GL diverged: operational={operational_balance}, GL={gl_balance}")

        expect_409(
            lambda: update_ledger_account(
                bdt_ledger.id,
                LedgerAccountUpdate(allow_manual_posting=True),
                req("PATCH", f"/accounting/chart-of-accounts/{bdt_ledger.id}"), db, tenant,  # type: ignore[arg-type]
            ),
            "re-enable manual posting on mapped financial ledger",
        )
        owner_equity = system_account(db, organization.id, "owners_equity")
        expect_409(
            lambda: create_manual_journal(
                JournalEntryCreate(
                    entry_date=business_today,
                    lines=[
                        JournalLineCreate(
                            ledger_account_id=bdt_ledger.id,
                            currency="BDT",
                            debit=Decimal("1"),
                            original_amount=Decimal("1"),
                        ),
                        JournalLineCreate(
                            ledger_account_id=owner_equity.id,
                            currency="BDT",
                            credit=Decimal("1"),
                            original_amount=Decimal("1"),
                        ),
                    ],
                ),
                req("POST", "/accounting/journals"), db, tenant,  # type: ignore[arg-type]
            ),
            "manual journal to mapped financial ledger",
        )

        expense = system_account(db, organization.id, "operating_expenses")
        bill = create_payable_bill(
            PayableBillCreate(
                supplier_name="USD Supplier",
                bill_date=invoice_date,
                due_date=settlement_date,
                currency="USD",
                amount=Decimal("100"),
                expense_ledger_account_id=expense.id,
                description="Foreign supplier service",
                reference=f"FX-AP-{marker}",
            ),
            req("POST", "/accounting/payables"), db, tenant,  # type: ignore[arg-type]
        )
        payable_payment = pay_payable_bill(
            bill.id,
            PayablePaymentCreate(
                financial_account_id=usd_bank.id,
                payment_date=settlement_date,
                amount=Decimal("100"),
                reference=f"FX-AP-PAY-{marker}",
            ),
            req("POST", f"/accounting/payables/{bill.id}/payments"), db, tenant,  # type: ignore[arg-type]
        )
        _, bill_lines = entry_lines(db, organization.id, "payable_bill", bill.id)
        if Decimal(bill_lines["accounts_payable"].credit) != Decimal("12000.00"):
            raise AssertionError("Payable bill did not use bill-date carrying value")
        _, payable_lines = entry_lines(db, organization.id, "payable_payment", payable_payment.id)
        usd_cash_key = f"financial_account:{usd_bank.id}"
        if Decimal(payable_lines["accounts_payable"].debit) != Decimal("12000.00"):
            raise AssertionError("Payable payment did not clear AP at carrying amount")
        if Decimal(payable_lines[usd_cash_key].credit) != Decimal("12500.00"):
            raise AssertionError("Payable settlement cash did not use settlement-date value")
        if Decimal(payable_lines["realized_fx_loss"].debit) != Decimal("500.00"):
            raise AssertionError("Payable settlement did not recognize BDT 500 realized FX loss")
        payable_debit = sum((Decimal(line.debit) for line in payable_lines.values()), Decimal("0"))
        payable_credit = sum((Decimal(line.credit) for line in payable_lines.values()), Decimal("0"))
        if payable_debit != payable_credit:
            raise AssertionError("Payable realized-FX journal is not balanced")

        original_accounting_local_date = accounting_api.organization_local_date
        original_report_local_date = accounting_reports_api.organization_local_date
        try:
            accounting_api.organization_local_date = lambda _: settlement_date
            accounting_reports_api.organization_local_date = lambda _: settlement_date
            tb = accounting_api.trial_balance(db, tenant, as_of=None)  # type: ignore[arg-type]
            if tb.as_of != settlement_date:
                raise AssertionError("Trial Balance default date did not use organization business date")
            statements = accounting_reports_api.financial_statements(
                db, tenant, date_from=invoice_date, date_to=None  # type: ignore[arg-type]
            )
            if statements.date_to != settlement_date:
                raise AssertionError("Financial Statements default date did not use organization business date")
        finally:
            accounting_api.organization_local_date = original_accounting_local_date
            accounting_reports_api.organization_local_date = original_report_local_date

        print(
            "V1 accounting integrity verification passed: historical FX -> realized AR gain -> realized AP loss -> financial account/GL lock -> organization business-date reports"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
