from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.crm import create_client
from app.api.v1.finance import create_invoice
from app.api.v1.financial_corrections import CorrectionRequest, correction_candidates, reverse_business_transaction
from app.api.v1.financial_safety import (
    safe_apply_customer_advance,
    safe_change_invoice_status,
    safe_create_account,
    safe_create_customer_advance,
    safe_create_income_with_fee,
    safe_create_money_entry,
)
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.accounting_money import AccountingMoneyEntry
from app.models.customer_advances import CustomerAdvanceApplication
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
from app.models.projects import Project
from app.schemas.accounting_money import AccountingIncomeWithFeeCreate, AccountingMoneyEntryCreate
from app.schemas.crm import ClientCreate
from app.schemas.customer_advances import CustomerAdvanceApply, CustomerAdvanceCreate
from app.schemas.finance import FinancialAccountCreate, InvoiceCreate, InvoiceItemInput, InvoiceStatusAction
from app.services.accounting_posting import system_account
from app.services.activity_log import record_activity
from app.services.exchange_rates import record_rate_snapshot


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str
    name: str
    country_code: str
    financial_year_start_month: int


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str
    organization: Org


def request(method: str, path: str, idempotency_key: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if idempotency_key:
        headers.append((b"idempotency-key", idempotency_key.encode()))
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": headers,
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def account_balance(db, organization_id: str, account_id: str) -> Decimal:
    account = db.scalar(
        select(FinancialAccount).where(
            FinancialAccount.id == account_id,
            FinancialAccount.organization_id == organization_id,
        )
    )
    if account is None:
        raise AssertionError("financial account fixture missing")
    rows = db.execute(
        select(FinancialTransaction.direction, FinancialTransaction.amount).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.account_id == account_id,
        )
    ).all()
    return Decimal(account.opening_balance) + sum(
        (Decimal(amount) if direction == "credit" else -Decimal(amount) for direction, amount in rows),
        Decimal("0"),
    )


def source_journal(db, organization_id: str, source_type: str, source_id: str) -> JournalEntry:
    journal = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )
    if journal is None:
        raise AssertionError(f"journal missing: {source_type}/{source_id}")
    return journal


def journal_rows(db, organization_id: str, journal_id: str):
    return db.execute(
        select(JournalLine, LedgerAccount.system_key, LedgerAccount.category)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(
            JournalLine.organization_id == organization_id,
            JournalLine.journal_entry_id == journal_id,
            LedgerAccount.organization_id == organization_id,
        )
    ).all()


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, o.name,
                   o.country_code, o.financial_year_start_month, m.id membership_id
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
            currency=str(row["currency"] or "BDT").upper(),
            name=str(row["name"]),
            country_code=str(row["country_code"] or "BD").upper(),
            financial_year_start_month=int(row["financial_year_start_month"] or 1),
        ),
    )

    # Numeric(18,2) financial records must never accept a positive value that
    # later becomes a zero-value posting.
    try:
        AccountingMoneyEntryCreate(
            kind="income",
            entry_date=date(2096, 6, 10),
            financial_account_id="fixture",
            category_ledger_account_id="fixture",
            amount=Decimal("0.001"),
            description="invalid sub-cent",
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("sub-cent direct money amount must be rejected")

    try:
        CustomerAdvanceCreate(
            client_id="fixture",
            financial_account_id="fixture",
            advance_date=date(2096, 7, 1),
            amount=Decimal("0.001"),
        )
    except ValidationError:
        pass
    else:
        raise AssertionError("sub-cent customer advance amount must be rejected")

    db = SessionLocal()
    marker = uuid4().hex[:8]
    try:
        base_account = safe_create_account(
            FinancialAccountCreate(
                name=f"CI Money Integrity {marker}",
                account_type="bank",
                currency=tenant.organization.currency,
                opening_balance=Decimal("0.00"),
            ),
            request("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        income_ledger = system_account(db, tenant.organization_id, "other_income")
        expense_ledger = system_account(db, tenant.organization_id, "operating_expenses")

        # Two real business events may legitimately have identical payloads.
        # Without an explicit retry key they must remain two independent records.
        duplicate_payload = AccountingMoneyEntryCreate(
            kind="income",
            entry_date=date(2096, 6, 10),
            financial_account_id=base_account.id,
            category_ledger_account_id=income_ledger.id,
            amount=Decimal("10.00"),
            description="CI two legitimate identical receipts",
            reference=f"CI-KEYLESS-{marker}",
        )
        keyless_one = safe_create_money_entry(
            duplicate_payload,
            request("POST", "/accounting/money"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        keyless_two = safe_create_money_entry(
            duplicate_payload,
            request("POST", "/accounting/money"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if keyless_one.id == keyless_two.id:
            raise AssertionError("two keyless legitimate money receipts were incorrectly collapsed")

        income_payload = AccountingMoneyEntryCreate(
            kind="income",
            entry_date=date(2096, 6, 11),
            financial_account_id=base_account.id,
            category_ledger_account_id=income_ledger.id,
            amount=Decimal("100.00"),
            description="CI direct other income",
            reference=f"CI-MONEY-IN-{marker}",
        )
        income_key = f"ci-money-in-{marker}"
        first_income = safe_create_money_entry(
            income_payload,
            request("POST", "/accounting/money", income_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        replay_income = safe_create_money_entry(
            income_payload,
            request("POST", "/accounting/money", income_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if first_income.id != replay_income.id:
            raise AssertionError("explicit direct-income retry created a second business record")
        if db.scalar(
            select(func.count(AccountingMoneyEntry.id)).where(
                AccountingMoneyEntry.organization_id == tenant.organization_id,
                AccountingMoneyEntry.reference == income_payload.reference,
            )
        ) != 1:
            raise AssertionError("explicit direct-income retry was not idempotent")

        income_journal = source_journal(db, tenant.organization_id, "accounting_money_entry", first_income.id)
        income_lines = journal_rows(db, tenant.organization_id, income_journal.id)
        if sum((Decimal(line.debit) for line, _, _ in income_lines), Decimal("0")) != Decimal("100.00"):
            raise AssertionError("direct income debit is incorrect")
        if sum((Decimal(line.credit) for line, _, _ in income_lines), Decimal("0")) != Decimal("100.00"):
            raise AssertionError("direct income credit is incorrect")
        if not any(category == "income" and Decimal(line.credit) == Decimal("100.00") for line, _, category in income_lines):
            raise AssertionError("direct income did not credit an income ledger")

        expense_payload = AccountingMoneyEntryCreate(
            kind="expense",
            entry_date=date(2096, 6, 12),
            financial_account_id=base_account.id,
            category_ledger_account_id=expense_ledger.id,
            amount=Decimal("15.00"),
            description="CI direct operating expense",
            reference=f"CI-MONEY-OUT-{marker}",
        )
        expense = safe_create_money_entry(
            expense_payload,
            request("POST", "/accounting/money", f"ci-money-out-{marker}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        expense_journal = source_journal(db, tenant.organization_id, "accounting_money_entry", expense.id)
        expense_lines = journal_rows(db, tenant.organization_id, expense_journal.id)
        if not any(category == "expense" and Decimal(line.debit) == Decimal("15.00") for line, _, category in expense_lines):
            raise AssertionError("direct expense did not debit an expense ledger")

        if account_balance(db, tenant.organization_id, base_account.id) != Decimal("105.00"):
            raise AssertionError("direct Money In/Out operational account balance is incorrect")

        project = db.scalar(
            select(Project)
            .where(Project.organization_id == tenant.organization_id)
            .order_by(Project.created_at.desc())
        )
        if project is None:
            raise AssertionError("money integrity verification requires a project fixture")
        mismatch_currency = "EUR" if project.currency.upper() != "EUR" else "USD"
        mismatch_account = safe_create_account(
            FinancialAccountCreate(
                name=f"CI Money FX Mismatch {marker}",
                account_type="bank",
                currency=mismatch_currency,
                opening_balance=Decimal("0.00"),
            ),
            request("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        mismatch_payload = AccountingMoneyEntryCreate(
            kind="income",
            entry_date=date(2096, 6, 12),
            financial_account_id=mismatch_account.id,
            category_ledger_account_id=income_ledger.id,
            amount=Decimal("10.00"),
            description="must not silently cross currencies",
            source_type="project",
            source_id=project.id,
        )
        try:
            safe_create_money_entry(
                mismatch_payload,
                request("POST", "/accounting/money", f"ci-money-fx-{marker}"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            if exc.status_code != 400 or "cross-currency" not in str(exc.detail).lower():
                raise AssertionError(f"unexpected project currency guard error: {exc.detail}") from exc
            db.rollback()
        else:
            raise AssertionError("project-linked direct money silently accepted a mismatched account currency")

        # The expected rollback above expires the unit-of-work. Re-load the
        # persisted records before correction verification.
        first_income_row = db.scalar(
            select(AccountingMoneyEntry).where(
                AccountingMoneyEntry.id == first_income.id,
                AccountingMoneyEntry.organization_id == tenant.organization_id,
            )
        )
        expense_row = db.scalar(
            select(AccountingMoneyEntry).where(
                AccountingMoneyEntry.id == expense.id,
                AccountingMoneyEntry.organization_id == tenant.organization_id,
            )
        )
        if first_income_row is None or expense_row is None:
            raise AssertionError("direct money fixtures disappeared after validation rollback")

        reverse_business_transaction(
            CorrectionRequest(
                source_type="money_entry",
                source_id=first_income_row.id,
                reason="CI direct income correction",
                reversal_date=date(2096, 6, 13),
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if account_balance(db, tenant.organization_id, base_account.id) != Decimal("5.00"):
            raise AssertionError("direct income reversal did not restore the financial-account movement")

        reversal_journal = db.scalar(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.reversed_entry_id == income_journal.id,
            )
        )
        if reversal_journal is None:
            raise AssertionError("direct money reversal journal is missing")
        reversal_tx = db.scalar(
            select(FinancialTransaction).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.source_id == first_income_row.id,
                FinancialTransaction.source_type.like("accounting_money_entry_reversal%"),
            )
        )
        if reversal_tx is None or reversal_tx.direction != "debit" or Decimal(reversal_tx.amount) != Decimal("100.00"):
            raise AssertionError("direct income operational reversal is incorrect")

        candidate_keys = {
            (item["source_type"], item["source_id"])
            for item in correction_candidates(db, tenant, limit=200)  # type: ignore[arg-type]
        }
        if ("money_entry", first_income_row.id) in candidate_keys:
            raise AssertionError("reversed direct money entry remains a correction candidate")
        if ("money_entry", expense_row.id) not in candidate_keys:
            raise AssertionError("unreversed direct expense is missing from correction candidates")

        bank_fees = system_account(db, tenant.organization_id, "bank_fees")
        income_with_fee_payload = AccountingIncomeWithFeeCreate(
            entry_date=date(2096, 6, 14),
            financial_account_id=base_account.id,
            income_category_ledger_account_id=income_ledger.id,
            gross_amount=Decimal("50.00"),
            fee_amount=Decimal("5.00"),
            fee_category_ledger_account_id=bank_fees.id,
            description="CI platform settlement income",
            fee_description="CI platform processing fee",
            reference=f"CI-INCOME-FEE-{marker}",
        )
        income_with_fee_key = f"ci-income-fee-{marker}"
        income_with_fee = safe_create_income_with_fee(
            income_with_fee_payload,
            request("POST", "/accounting/money/income-with-fee", income_with_fee_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        replay_income_with_fee = safe_create_income_with_fee(
            income_with_fee_payload,
            request("POST", "/accounting/money/income-with-fee", income_with_fee_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if income_with_fee.income_entry.id != replay_income_with_fee.income_entry.id:
            raise AssertionError("income-with-fee retry duplicated the gross receipt")
        if income_with_fee.fee_entry is None or replay_income_with_fee.fee_entry is None:
            raise AssertionError("income-with-fee verification requires a linked fee entry")
        if income_with_fee.fee_entry.id != replay_income_with_fee.fee_entry.id:
            raise AssertionError("income-with-fee retry duplicated the processing fee")
        if income_with_fee.net_amount != Decimal("45.00"):
            raise AssertionError("income-with-fee net amount is incorrect")
        if account_balance(db, tenant.organization_id, base_account.id) != Decimal("50.00"):
            raise AssertionError("income-with-fee did not reconcile gross receipt less fee to the account balance")

        # Foreign-currency advance application must clear both monetary balances
        # at their historical carrying values rather than application-date spot.
        foreign_currency = "EUR" if tenant.organization.currency != "EUR" else "USD"
        advance_date = date(2096, 7, 1)
        invoice_date = date(2096, 7, 2)
        application_date = date(2096, 7, 3)
        for effective_date, fx_rate in (
            (advance_date, Decimal("120.00000000")),
            (invoice_date, Decimal("125.00000000")),
            (application_date, Decimal("130.00000000")),
        ):
            record_rate_snapshot(
                db,
                organization_id=tenant.organization_id,
                base_currency=foreign_currency,
                quote_currency=tenant.organization.currency,
                effective_date=effective_date,
                reference_rate=fx_rate,
                effective_rate=fx_rate,
                source="ci_accounting_money_integrity",
                user_id=tenant.user_id,
            )
        record_activity(
            db,
            action="verification.accounting_money.fx_seeded",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization",
            entity_id=tenant.organization_id,
            after={
                "currency": foreign_currency,
                "advance_rate": "120",
                "invoice_rate": "125",
                "application_rate": "130",
            },
            message="Seeded FX rates for customer advance carrying-value verification",
        )
        db.commit()

        client = create_client(
            ClientCreate(
                client_type="company",
                display_name=f"CI Advance Client {marker}",
                currency=foreign_currency,
            ),
            request("POST", "/crm/clients"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        foreign_account = safe_create_account(
            FinancialAccountCreate(
                name=f"CI Advance Bank {marker}",
                account_type="bank",
                currency=foreign_currency,
                opening_balance=Decimal("0.00"),
            ),
            request("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        advance_payload = CustomerAdvanceCreate(
            client_id=client.id,
            financial_account_id=foreign_account.id,
            advance_date=advance_date,
            amount=Decimal("100.00"),
            reference=f"CI-ADV-{marker}",
        )
        advance_key = f"ci-advance-{marker}"
        advance = safe_create_customer_advance(
            advance_payload,
            request("POST", "/accounting/customer-advances", advance_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        replay_advance = safe_create_customer_advance(
            advance_payload,
            request("POST", "/accounting/customer-advances", advance_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if advance.id != replay_advance.id:
            raise AssertionError("customer advance retry created a second receipt")
        if account_balance(db, tenant.organization_id, foreign_account.id) != Decimal("100.00"):
            raise AssertionError("customer advance receipt did not increase the foreign account exactly once")

        invoice = create_invoice(
            InvoiceCreate(
                client_id=client.id,
                subject="CI advance settlement invoice",
                issue_date=invoice_date,
                currency=foreign_currency,
                items=[
                    InvoiceItemInput(
                        item_name="Advance settlement service",
                        description="CI customer advance carrying-value verification",
                        quantity=Decimal("1"),
                        unit_price=Decimal("100"),
                    )
                ],
            ),
            request("POST", "/finance/invoices"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        sent = safe_change_invoice_status(
            invoice.id,
            InvoiceStatusAction(action="send"),
            request("PATCH", f"/finance/invoices/{invoice.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        try:
            safe_apply_customer_advance(
                advance.id,
                CustomerAdvanceApply(
                    invoice_id=sent.id,
                    application_date=advance_date,
                    amount=Decimal("10.00"),
                ),
                request("POST", f"/accounting/customer-advances/{advance.id}/apply", f"ci-advance-backdate-{marker}"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            if exc.status_code != 409 or "invoice issue date" not in str(exc.detail).lower():
                raise AssertionError(f"unexpected backdated advance application error: {exc.detail}") from exc
            db.rollback()
        else:
            raise AssertionError("customer advance application before invoice issue date must be blocked")

        application_payload = CustomerAdvanceApply(
            invoice_id=sent.id,
            application_date=application_date,
            amount=Decimal("100.00"),
        )
        application_key = f"ci-advance-apply-{marker}"
        applied = safe_apply_customer_advance(
            advance.id,
            application_payload,
            request("POST", f"/accounting/customer-advances/{advance.id}/apply", application_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        replay_applied = safe_apply_customer_advance(
            advance.id,
            application_payload,
            request("POST", f"/accounting/customer-advances/{advance.id}/apply", application_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if applied.id != replay_applied.id or Decimal(replay_applied.remaining_amount) != Decimal("0.00"):
            raise AssertionError("customer advance application retry was not idempotent")
        applications = db.scalars(
            select(CustomerAdvanceApplication).where(
                CustomerAdvanceApplication.organization_id == tenant.organization_id,
                CustomerAdvanceApplication.advance_id == advance.id,
                CustomerAdvanceApplication.invoice_id == sent.id,
            )
        ).all()
        if len(applications) != 1:
            raise AssertionError(f"expected one customer advance application, found {len(applications)}")
        application = applications[0]
        app_journal = source_journal(
            db,
            tenant.organization_id,
            "customer_advance_application",
            application.id,
        )
        app_lines = journal_rows(db, tenant.organization_id, app_journal.id)
        liability_debit = sum(
            (Decimal(line.debit) for line, key, _ in app_lines if key == "customer_advances"),
            Decimal("0"),
        )
        ar_credit = sum(
            (Decimal(line.credit) for line, key, _ in app_lines if key == "accounts_receivable"),
            Decimal("0"),
        )
        fx_loss = sum(
            (Decimal(line.debit) for line, key, _ in app_lines if key == "realized_fx_loss"),
            Decimal("0"),
        )
        if liability_debit != Decimal("12000.00"):
            raise AssertionError(f"advance liability did not clear at receipt carrying value: {liability_debit}")
        if ar_credit != Decimal("12500.00"):
            raise AssertionError(f"invoice receivable did not clear at invoice carrying value: {ar_credit}")
        if fx_loss != Decimal("500.00"):
            raise AssertionError(f"advance application realized FX loss should be 500.00, got {fx_loss}")
        if account_balance(db, tenant.organization_id, foreign_account.id) != Decimal("100.00"):
            raise AssertionError("applying customer credit incorrectly created a second cash movement")

        # Receipt reversal is dependency-aware: an applied customer credit must
        # first be detached from the invoice.
        try:
            reverse_business_transaction(
                CorrectionRequest(
                    source_type="customer_advance",
                    source_id=advance.id,
                    reason="CI dependency protection",
                    reversal_date=date(2096, 7, 4),
                ),
                request("POST", "/accounting/corrections/reverse"),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            if exc.status_code != 409 or "dependent" not in str(exc.detail).lower():
                raise AssertionError(f"unexpected customer advance dependency error: {exc.detail}") from exc
            db.rollback()
        else:
            raise AssertionError("customer advance receipt reversal must be blocked while an application is active")

        reverse_business_transaction(
            CorrectionRequest(
                source_type="customer_advance_application",
                source_id=application.id,
                reason="CI reverse advance application",
                reversal_date=date(2096, 7, 4),
            ),
            request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        restored_advance = db.scalar(
            select(CustomerAdvanceApplication.advance_id).where(
                CustomerAdvanceApplication.id == application.id,
                CustomerAdvanceApplication.organization_id == tenant.organization_id,
            )
        )
        restored_invoice = db.scalar(
            select(Invoice).where(
                Invoice.id == sent.id,
                Invoice.organization_id == tenant.organization_id,
            )
        )
        refreshed_advance = safe_create_customer_advance(
            advance_payload,
            request("POST", "/accounting/customer-advances", advance_key),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if restored_advance != advance.id or Decimal(refreshed_advance.remaining_amount) != Decimal("100.00"):
            raise AssertionError("reversing advance application did not restore customer credit")
        if restored_invoice is None or Decimal(restored_invoice.amount_paid) != Decimal("0.00") or Decimal(restored_invoice.balance_due) != Decimal("100.00") or restored_invoice.status != "sent":
            raise AssertionError("reversing advance application did not reopen the invoice")
        if account_balance(db, tenant.organization_id, foreign_account.id) != Decimal("100.00"):
            raise AssertionError("advance application reversal incorrectly moved cash")

        reapplied = safe_apply_customer_advance(
            advance.id,
            CustomerAdvanceApply(
                invoice_id=sent.id,
                application_date=date(2096, 7, 5),
                amount=Decimal("100.00"),
            ),
            request("POST", f"/accounting/customer-advances/{advance.id}/apply", f"ci-advance-reapply-{marker}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if Decimal(reapplied.remaining_amount) != Decimal("0.00"):
            raise AssertionError("re-applying restored customer credit did not consume the advance")
        db.expire_all()
        settled_invoice = db.scalar(
            select(Invoice).where(
                Invoice.id == sent.id,
                Invoice.organization_id == tenant.organization_id,
            )
        )
        if settled_invoice is None or Decimal(settled_invoice.amount_paid) != Decimal("100.00") or Decimal(settled_invoice.balance_due) != Decimal("0.00") or settled_invoice.status != "paid":
            raise AssertionError("customer advance re-application did not settle the invoice")

        reapplication = db.scalar(
            select(CustomerAdvanceApplication)
            .where(
                CustomerAdvanceApplication.organization_id == tenant.organization_id,
                CustomerAdvanceApplication.advance_id == advance.id,
                CustomerAdvanceApplication.id != application.id,
            )
            .order_by(CustomerAdvanceApplication.created_at.desc())
        )
        if reapplication is None:
            raise AssertionError("replacement customer advance application is missing")
        reapplication_journal = source_journal(
            db,
            tenant.organization_id,
            "customer_advance_application",
            reapplication.id,
        )
        reapplication_lines = journal_rows(db, tenant.organization_id, reapplication_journal.id)
        if sum((Decimal(line.debit) for line, key, _ in reapplication_lines if key == "customer_advances"), Decimal("0")) != Decimal("12000.00"):
            raise AssertionError("reversed advance application incorrectly reduced liability carrying value on re-application")
        if sum((Decimal(line.credit) for line, key, _ in reapplication_lines if key == "accounts_receivable"), Decimal("0")) != Decimal("12500.00"):
            raise AssertionError("reversed advance application incorrectly reduced AR carrying value on re-application")
        if sum((Decimal(line.debit) for line, key, _ in reapplication_lines if key == "realized_fx_loss"), Decimal("0")) != Decimal("500.00"):
            raise AssertionError("replacement advance application did not restore the correct realized FX loss")

        candidate_keys = {
            (item["source_type"], item["source_id"])
            for item in correction_candidates(db, tenant, limit=200)  # type: ignore[arg-type]
        }
        if ("customer_advance_application", application.id) in candidate_keys:
            raise AssertionError("reversed customer advance application remains a correction candidate")
        if ("customer_advance_application", reapplication.id) not in candidate_keys:
            raise AssertionError("active customer advance application is missing from correction candidates")

        trial = trial_balance(db, tenant, as_of=date(2096, 7, 5))  # type: ignore[arg-type]
        if trial.total_debit != trial.total_credit:
            raise AssertionError("trial balance became unbalanced after Money In/Out verification")
        statements = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=date(2096, 6, 10),
            date_to=date(2096, 7, 5),
        )
        if statements.net_profit != statements.total_income - statements.total_expenses:
            raise AssertionError("P&L does not reconcile after Money In/Out verification")
        if statements.total_assets != statements.total_liabilities_and_equity:
            raise AssertionError("balance sheet does not balance after Money In/Out verification")

        print(
            "accounting money integrity verification passed: keyless independence + explicit idempotency + "
            "direct income/expense + currency guard + auditable reversal + customer-advance carrying values/FX/corrections + reports"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
