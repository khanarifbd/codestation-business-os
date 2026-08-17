from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.company_currencies import (
    AccountingCurrencyChangeRequest,
    change_accounting_currency,
    get_company_currency_settings,
)
from app.api.v1.organizations import create_organization
from app.db.session import SessionLocal
from app.models.accounting import (
    JournalEntry,
    JournalLine,
    OrganizationFunctionalCurrencyPeriod,
)
from app.models.company_settings import OrganizationFinancialSettings
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationCreate
from app.services.accounting_posting import PostingLine, ensure_default_chart, post_journal, system_account
from app.services.activity_log import record_activity


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


def main() -> None:
    db = SessionLocal()
    marker = uuid4().hex[:10]
    try:
        user = db.scalar(select(User).order_by(User.created_at.asc()))
        if user is None:
            raise AssertionError("functional currency verification requires a user fixture")

        created = create_organization(
            OrganizationCreate(
                name=f"Functional Currency {marker}",
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
            raise AssertionError("functional currency organization was not created")
        tenant = FixtureTenant(
            organization_id=organization.id,
            user_id=user.id,
            organization=organization,
        )

        ensure_default_chart(db, organization.id, user.id)
        cash = system_account(db, organization.id, "cash_equivalents")
        owner_equity = system_account(db, organization.id, "owners_equity")
        service_revenue = system_account(db, organization.id, "service_revenue")
        operating_expense = system_account(db, organization.id, "operating_expenses")

        old_date = date.today() - timedelta(days=2)
        effective_date = date.today() - timedelta(days=1)
        new_date = date.today()

        old_entries = [
            post_journal(
                db,
                organization_id=organization.id,
                user_id=user.id,
                entry_date=old_date,
                source_type="functional_currency_fixture_capital",
                source_id=str(uuid4()),
                lines=[
                    PostingLine(ledger_account_id=cash.id, debit=Decimal("100000"), currency="BDT", original_amount=Decimal("100000")),
                    PostingLine(ledger_account_id=owner_equity.id, credit=Decimal("100000"), currency="BDT", original_amount=Decimal("100000")),
                ],
                memo="BDT capital before functional currency change",
            ),
            post_journal(
                db,
                organization_id=organization.id,
                user_id=user.id,
                entry_date=old_date,
                source_type="functional_currency_fixture_income",
                source_id=str(uuid4()),
                lines=[
                    PostingLine(ledger_account_id=cash.id, debit=Decimal("20000"), currency="BDT", original_amount=Decimal("20000")),
                    PostingLine(ledger_account_id=service_revenue.id, credit=Decimal("20000"), currency="BDT", original_amount=Decimal("20000")),
                ],
                memo="BDT income before functional currency change",
            ),
            post_journal(
                db,
                organization_id=organization.id,
                user_id=user.id,
                entry_date=old_date,
                source_type="functional_currency_fixture_expense",
                source_id=str(uuid4()),
                lines=[
                    PostingLine(ledger_account_id=operating_expense.id, debit=Decimal("5000"), currency="BDT", original_amount=Decimal("5000")),
                    PostingLine(ledger_account_id=cash.id, credit=Decimal("5000"), currency="BDT", original_amount=Decimal("5000")),
                ],
                memo="BDT expense before functional currency change",
            ),
        ]
        record_activity(
            db,
            action="verification.functional_currency.old_period_fixture",
            scope="tenant",
            actor_user_id=user.id,
            organization_id=organization.id,
            entity_type="journal_entry",
            entity_id=old_entries[0].id,
            after={
                "functional_currency": "BDT",
                "entry_date": old_date.isoformat(),
                "journal_ids": [entry.id for entry in old_entries],
            },
            message="Created audited BDT journals for functional currency transition verification",
            request=req("POST", "/verification/functional-currency/old-period"),
        )
        db.commit()

        for entry in old_entries:
            db.refresh(entry)
            if entry.functional_currency != "BDT":
                raise AssertionError("pre-transition journal did not persist BDT functional currency")

        old_line_snapshot = db.execute(
            select(JournalLine.id, JournalLine.debit, JournalLine.credit, JournalLine.currency)
            .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
            .where(
                JournalLine.organization_id == organization.id,
                JournalEntry.functional_currency == "BDT",
            )
            .order_by(JournalLine.id.asc())
        ).all()

        before_settings = get_company_currency_settings(db, tenant)  # type: ignore[arg-type]
        if before_settings.accounting_currency != "BDT" or not before_settings.accounting_currency_locked:
            raise AssertionError("pre-transition currency settings are not BDT and protected")

        changed = change_accounting_currency(
            AccountingCurrencyChangeRequest(
                new_currency="AUD",
                effective_date=effective_date,
                transition_rate=Decimal("0.01000000"),
                reason="Primary economic environment moved to Australia",
            ),
            req("POST", "/company-settings/currencies/change-accounting"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        if changed.accounting_currency != "AUD":
            raise AssertionError("current accounting currency did not change to AUD")
        if changed.reporting_currency != "BDT" or changed.default_client_currency != "BDT":
            raise AssertionError("functional currency transition changed reporting/client defaults")
        if len(changed.functional_currency_periods) != 2:
            raise AssertionError("functional currency history does not contain old and new periods")

        periods = db.scalars(
            select(OrganizationFunctionalCurrencyPeriod)
            .where(OrganizationFunctionalCurrencyPeriod.organization_id == organization.id)
            .order_by(OrganizationFunctionalCurrencyPeriod.effective_from.asc())
        ).all()
        if periods[0].currency != "BDT" or periods[0].effective_to != old_date:
            raise AssertionError("BDT functional currency period was not sealed on the expected date")
        if periods[1].currency != "AUD" or periods[1].effective_from != effective_date:
            raise AssertionError("AUD functional currency period did not start on the expected date")
        if Decimal(periods[1].transition_rate or 0) != Decimal("0.01000000"):
            raise AssertionError("functional currency transition rate was not preserved")

        organization = db.get(Organization, organization.id)
        financial = db.scalar(
            select(OrganizationFinancialSettings).where(
                OrganizationFinancialSettings.organization_id == tenant.organization_id
            )
        )
        if organization is None or organization.currency != "AUD":
            raise AssertionError("organization current functional currency pointer is not AUD")
        if financial is None or financial.accounting_currency != "AUD":
            raise AssertionError("financial accounting currency pointer is not AUD")

        transition = db.scalar(
            select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.source_type == "functional_currency_transition",
            )
        )
        if transition is None or transition.functional_currency != "AUD" or transition.entry_date != effective_date:
            raise AssertionError("AUD transition opening journal was not created")
        transition_lines = db.scalars(
            select(JournalLine).where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == transition.id,
            )
        ).all()
        transition_debit = sum((Decimal(line.debit) for line in transition_lines), Decimal("0"))
        transition_credit = sum((Decimal(line.credit) for line in transition_lines), Decimal("0"))
        if transition_debit != transition_credit or transition_debit != Decimal("1150.00"):
            raise AssertionError(f"converted opening journal is not balanced at AUD 1150.00: {transition_debit}/{transition_credit}")

        old_line_after = db.execute(
            select(JournalLine.id, JournalLine.debit, JournalLine.credit, JournalLine.currency)
            .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalEntry.functional_currency == "BDT",
            )
            .order_by(JournalLine.id.asc())
        ).all()
        if old_line_after != old_line_snapshot:
            raise AssertionError("historical BDT journal lines were rewritten by the functional currency change")

        try:
            post_journal(
                db,
                organization_id=tenant.organization_id,
                user_id=user.id,
                entry_date=old_date,
                source_type="functional_currency_fixture_forbidden_backdate",
                source_id=str(uuid4()),
                lines=[
                    PostingLine(ledger_account_id=cash.id, debit=Decimal("1"), currency="BDT", original_amount=Decimal("1")),
                    PostingLine(ledger_account_id=owner_equity.id, credit=Decimal("1"), currency="BDT", original_amount=Decimal("1")),
                ],
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                raise AssertionError(f"sealed functional period returned wrong status: {exc.status_code}") from exc
            db.rollback()
        else:
            raise AssertionError("sealed BDT functional period accepted a new journal")

        # Reload ORM objects after rollback from the intentional negative test.
        organization = db.get(Organization, tenant.organization_id)
        if organization is None:
            raise AssertionError("organization disappeared after sealed-period test")
        tenant = FixtureTenant(organization_id=organization.id, user_id=user.id, organization=organization)
        cash = system_account(db, organization.id, "cash_equivalents")
        owner_equity = system_account(db, organization.id, "owners_equity")

        new_entry = post_journal(
            db,
            organization_id=organization.id,
            user_id=user.id,
            entry_date=new_date,
            source_type="functional_currency_fixture_aud_capital",
            source_id=str(uuid4()),
            lines=[
                PostingLine(ledger_account_id=cash.id, debit=Decimal("100"), currency="AUD", original_amount=Decimal("100")),
                PostingLine(ledger_account_id=owner_equity.id, credit=Decimal("100"), currency="AUD", original_amount=Decimal("100")),
            ],
            memo="AUD capital after functional currency change",
        )
        record_activity(
            db,
            action="verification.functional_currency.new_period_fixture",
            scope="tenant",
            actor_user_id=user.id,
            organization_id=organization.id,
            entity_type="journal_entry",
            entity_id=new_entry.id,
            after={
                "functional_currency": "AUD",
                "entry_date": new_date.isoformat(),
                "journal_id": new_entry.id,
            },
            message="Created audited AUD journal for functional currency transition verification",
            request=req("POST", "/verification/functional-currency/new-period"),
        )
        db.commit()
        db.refresh(new_entry)
        if new_entry.functional_currency != "AUD":
            raise AssertionError("post-transition journal did not persist AUD functional currency")

        current_tb = trial_balance(db, tenant, as_of=new_date)  # type: ignore[arg-type]
        if current_tb.accounting_currency != "AUD" or current_tb.functional_period_start != effective_date:
            raise AssertionError("current trial balance is not scoped to the AUD functional period")
        if current_tb.total_debit != Decimal("1250.00") or current_tb.total_credit != Decimal("1250.00"):
            raise AssertionError(f"AUD trial balance mixed or lost values: {current_tb.total_debit}/{current_tb.total_credit}")

        old_tb = trial_balance(db, tenant, as_of=old_date)  # type: ignore[arg-type]
        if old_tb.accounting_currency != "BDT":
            raise AssertionError("historical trial balance did not resolve BDT functional currency")
        if old_tb.total_debit != Decimal("125000.00") or old_tb.total_credit != Decimal("125000.00"):
            raise AssertionError(f"historical BDT trial balance was altered: {old_tb.total_debit}/{old_tb.total_credit}")

        statements = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=effective_date,
            date_to=new_date,
        )
        if statements.accounting_currency != "AUD" or statements.functional_period_start != effective_date:
            raise AssertionError("financial statements are not scoped to the AUD functional period")

        try:
            financial_statements(
                db,
                tenant,  # type: ignore[arg-type]
                date_from=old_date,
                date_to=new_date,
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                raise AssertionError(f"cross-functional report returned wrong status: {exc.status_code}") from exc
        else:
            raise AssertionError("financial statements raw-summed BDT and AUD functional periods")

    finally:
        db.close()

    print("effective-dated functional currency transition verification passed")


if __name__ == "__main__":
    main()
