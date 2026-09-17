from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.crm import create_client
from app.api.v1.finance import create_invoice
from app.api.v1.financial_safety import safe_change_invoice_status, safe_create_account, safe_record_payment
from app.api.v1.organizations import create_organization
from app.db.session import SessionLocal
from app.models.accounting import JournalEntry, JournalLine
from app.models.organization import Organization
from app.models.user import User
from app.schemas.crm import ClientCreate
from app.schemas.finance import FinancialAccountCreate, InvoiceCreate, InvoiceItemInput, InvoiceStatusAction, PaymentCreate
from app.schemas.organization import OrganizationCreate
from app.services.accounting_posting import financial_ledger_account, money


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: Organization


def req(method: str, path: str, idempotency_key: str | None = None) -> Request:
    headers = []
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


def journal_for(db, organization_id: str, source_type: str, source_id: str) -> JournalEntry:
    entry = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )
    if entry is None:
        raise AssertionError(f"missing immediate journal {source_type}/{source_id}")
    debit, credit = db.execute(
        select(func.coalesce(func.sum(JournalLine.debit), 0), func.coalesce(func.sum(JournalLine.credit), 0)).where(
            JournalLine.organization_id == organization_id,
            JournalLine.journal_entry_id == entry.id,
        )
    ).one()
    if money(Decimal(debit)) != money(Decimal(credit)) or money(Decimal(debit)) <= 0:
        raise AssertionError(f"journal {entry.entry_number} is not balanced")
    return entry


def main() -> None:
    db = SessionLocal()
    marker = uuid4().hex[:10]
    try:
        fixture_org = db.scalar(
            select(Organization)
            .where(Organization.name == "Existing Tenant Fixture")
            .order_by(Organization.created_at.desc())
        )
        if fixture_org is None:
            raise AssertionError("atomic accounting verification requires the existing tenant fixture")
        user = db.get(User, fixture_org.created_by_user_id)
        if user is None or user.system_role != "user":
            raise AssertionError("atomic accounting verification requires a regular tenant fixture owner")

        created = create_organization(
            OrganizationCreate(
                name=f"Atomic Accounting {marker}",
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
            raise AssertionError("atomic accounting organization was not created")
        tenant = FixtureTenant(organization_id=organization.id, user_id=user.id, organization=organization)

        client = create_client(
            ClientCreate(
                client_type="company",
                display_name="Atomic Flow Customer",
                country_code="BD",
                currency="BDT",
            ),
            req("POST", "/crm/clients"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        account = safe_create_account(
            FinancialAccountCreate(
                name=f"Atomic Bank {marker}",
                account_type="bank",
                currency="BDT",
                opening_balance=Decimal("5000"),
            ),
            req("POST", "/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        journal_for(db, organization.id, "financial_account_opening_balance", account.id)

        invoice = create_invoice(
            InvoiceCreate(
                client_id=client.id,
                subject="Atomic accounting service",
                currency="BDT",
                items=[
                    InvoiceItemInput(
                        item_name="Engineering service",
                        description="Atomic journal verification",
                        quantity=Decimal("1"),
                        unit_price=Decimal("1000"),
                    )
                ],
            ),
            req("POST", "/finance/invoices"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        sent = safe_change_invoice_status(
            invoice.id,
            InvoiceStatusAction(action="send"),
            req("PATCH", f"/finance/invoices/{invoice.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        journal_for(db, organization.id, "invoice_issue", sent.id)

        payment = safe_record_payment(
            PaymentCreate(
                invoice_id=sent.id,
                account_id=account.id,
                invoice_amount=Decimal("1000"),
                account_amount=Decimal("1000"),
                method="bank_transfer",
                reference=f"ATOMIC-PAY-{marker}",
            ),
            req("POST", "/finance/payments", f"atomic-payment-{marker}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        payment_journal = journal_for(db, organization.id, "invoice_payment", payment.id)

        # The public mutation path must be complete without calling accounting sync.
        financial, ledger = financial_ledger_account(db, organization.id, account.id)

        from app.models.finance import FinancialTransaction

        transactions = db.execute(
            select(FinancialTransaction.direction, FinancialTransaction.amount).where(
                FinancialTransaction.organization_id == organization.id,
                FinancialTransaction.account_id == account.id,
            )
        ).all()
        operational_balance = Decimal(financial.opening_balance) + sum(
            (Decimal(amount) if direction == "credit" else -Decimal(amount) for direction, amount in transactions),
            Decimal("0"),
        )
        gl_balance = Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0))
                .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
                .where(
                    JournalLine.organization_id == organization.id,
                    JournalLine.ledger_account_id == ledger.id,
                    JournalEntry.organization_id == organization.id,
                    JournalEntry.status == "posted",
                )
            ) or 0
        )
        if money(operational_balance) != Decimal("6000.00") or money(gl_balance) != Decimal("6000.00"):
            raise AssertionError(f"atomic account/GL mismatch: operational={operational_balance}, gl={gl_balance}")

        today = sent.issue_date
        tb = trial_balance(db, tenant, as_of=today)  # type: ignore[arg-type]
        if money(tb.total_debit) != money(tb.total_credit):
            raise AssertionError("trial balance is not balanced after atomic invoice/payment flow")

        statements = financial_statements(db, tenant, date_from=today, date_to=today)  # type: ignore[arg-type]
        if money(statements.total_income) != Decimal("1000.00"):
            raise AssertionError(f"P&L income is stale or incorrect: {statements.total_income}")
        if money(statements.net_profit) != Decimal("1000.00"):
            raise AssertionError(f"P&L net profit is stale or incorrect: {statements.net_profit}")
        if money(statements.total_assets) != money(statements.total_liabilities_and_equity):
            raise AssertionError(
                f"balance sheet is not balanced: assets={statements.total_assets}, "
                f"liabilities+equity={statements.total_liabilities_and_equity}"
            )

        # Application-level source lookups are not enough under concurrency. The
        # database must reject a second journal for the same tenant/source pair.
        source_date = payment_journal.entry_date
        source_currency = payment_journal.functional_currency
        duplicate_entry = JournalEntry(
            organization_id=organization.id,
            entry_number=f"CI-DUP-{uuid4().hex[:12].upper()}",
            entry_date=source_date,
            functional_currency=source_currency,
            status="posted",
            source_type=payment_journal.source_type,
            source_id=payment_journal.source_id,
            reference="CI duplicate source idempotency guard",
            memo="This row must be rejected by the unique source index",
            created_by_user_id=user.id,
            posted_by_user_id=user.id,
        )
        db.add(duplicate_entry)
        try:
            db.flush()
        except IntegrityError as exc:
            db.rollback()
            if "ix_journal_entries_org_source" not in str(exc.orig):
                raise AssertionError(
                    f"duplicate source journal failed for an unexpected reason: {exc.orig}"
                ) from exc
        else:
            raise AssertionError("database allowed a second journal for the same operational source")

        # NULL source ids are intentional for manual/source-less journals and must
        # remain legal even though source-backed journals are unique.
        manual_marker = uuid4().hex[:8].upper()
        db.add_all(
            [
                JournalEntry(
                    organization_id=organization.id,
                    entry_number=f"CI-MAN-{manual_marker}-A",
                    entry_date=source_date,
                    functional_currency=source_currency,
                    status="posted",
                    source_type="manual",
                    source_id=None,
                    reference="CI nullable source guard A",
                    created_by_user_id=user.id,
                    posted_by_user_id=user.id,
                ),
                JournalEntry(
                    organization_id=organization.id,
                    entry_number=f"CI-MAN-{manual_marker}-B",
                    entry_date=source_date,
                    functional_currency=source_currency,
                    status="posted",
                    source_type="manual",
                    source_id=None,
                    reference="CI nullable source guard B",
                    created_by_user_id=user.id,
                    posted_by_user_id=user.id,
                ),
            ]
        )
        db.flush()
        db.rollback()
    finally:
        db.close()

    print("atomic financial flow verification passed: invoice -> payment -> journal -> trial balance -> P&L -> balance sheet, with database source idempotency")


if __name__ == "__main__":
    main()
