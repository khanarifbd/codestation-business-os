from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.db.session import SessionLocal, engine
from app.models.accounting import JournalLine
from app.models.company_defaults import OrganizationExchangeRate
from app.services.accounting_posting import PostingLine, money, post_journal, system_account
from app.services.exchange_rates import record_rate_snapshot


RATE = Decimal("122.34567890")


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.currency
            FROM organizations o
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC
            LIMIT 1
        """)).mappings().one()

    organization_id = str(row["organization_id"])
    user_id = str(row["user_id"])
    base_currency = str(row["currency"] or "BDT").upper()
    foreign_currency = "USD" if base_currency != "USD" else "EUR"
    marker = uuid4().hex[:8]

    db = SessionLocal()
    try:
        exchange_rate = db.scalar(
            select(OrganizationExchangeRate).where(
                OrganizationExchangeRate.organization_id == organization_id,
                OrganizationExchangeRate.base_currency == foreign_currency,
                OrganizationExchangeRate.quote_currency == base_currency,
            )
        )
        if exchange_rate is None:
            exchange_rate = OrganizationExchangeRate(
                organization_id=organization_id,
                base_currency=foreign_currency,
                quote_currency=base_currency,
                reference_rate=RATE,
                manual_rate=RATE,
                effective_rate=RATE,
                source="ci_multicurrency_verification",
            )
            db.add(exchange_rate)
        else:
            exchange_rate.reference_rate = RATE
            exchange_rate.manual_rate = RATE
            exchange_rate.effective_rate = RATE
            exchange_rate.source = "ci_multicurrency_verification"
        db.flush()
        record_rate_snapshot(
            db,
            organization_id=organization_id,
            base_currency=foreign_currency,
            quote_currency=base_currency,
            effective_date=date(2098, 1, 1),
            reference_rate=RATE,
            effective_rate=RATE,
            source="ci_multicurrency_verification",
            user_id=user_id,
        )

        cash = system_account(db, organization_id, "cash_equivalents")
        revenue = system_account(db, organization_id, "service_revenue")
        fees = system_account(db, organization_id, "bank_fees")
        loans_payable = system_account(db, organization_id, "loans_payable")

        simple_amount = Decimal("1000.00")
        simple = post_journal(
            db,
            organization_id=organization_id,
            user_id=user_id,
            entry_date=date(2098, 1, 10),
            source_type="verify_multicurrency_simple",
            source_id=f"simple-{marker}",
            lines=[
                PostingLine(ledger_account_id=cash.id, debit=simple_amount, currency=foreign_currency),
                PostingLine(ledger_account_id=revenue.id, credit=simple_amount, currency=foreign_currency),
            ],
            reference=f"MC-SIMPLE-{marker}",
        )
        simple_lines = db.scalars(select(JournalLine).where(JournalLine.organization_id == organization_id, JournalLine.journal_entry_id == simple.id)).all()
        expected_simple_base = money(simple_amount * RATE)
        if len(simple_lines) != 2: raise AssertionError("Expected two journal lines for simple foreign-currency posting")
        if sum((Decimal(line.debit) for line in simple_lines), Decimal("0")) != expected_simple_base: raise AssertionError("Foreign-currency debit was not converted to organization base currency")
        if sum((Decimal(line.credit) for line in simple_lines), Decimal("0")) != expected_simple_base: raise AssertionError("Foreign-currency credit was not converted to organization base currency")
        for line in simple_lines:
            if line.currency != foreign_currency: raise AssertionError("Original transaction currency was not preserved")
            if Decimal(line.original_amount) != simple_amount: raise AssertionError("Original foreign amount was not preserved")
            if Decimal(line.exchange_rate_to_base) != RATE.quantize(Decimal("0.00000001")): raise AssertionError("Exchange rate was not preserved on journal line")

        principal = Decimal("1000.02"); fee = Decimal("0.01"); net = Decimal("1000.01")
        split = post_journal(
            db,
            organization_id=organization_id,
            user_id=user_id,
            entry_date=date(2098, 1, 11),
            source_type="verify_multicurrency_split",
            source_id=f"split-{marker}",
            lines=[
                PostingLine(ledger_account_id=cash.id, debit=net, currency=foreign_currency),
                PostingLine(ledger_account_id=fees.id, debit=fee, currency=foreign_currency),
                PostingLine(ledger_account_id=loans_payable.id, credit=principal, currency=foreign_currency),
            ],
            reference=f"MC-SPLIT-{marker}",
        )
        split_lines = db.scalars(select(JournalLine).where(JournalLine.organization_id == organization_id, JournalLine.journal_entry_id == split.id)).all()
        debit_total = money(sum((Decimal(line.debit) for line in split_lines), Decimal("0"))); credit_total = money(sum((Decimal(line.credit) for line in split_lines), Decimal("0")))
        if debit_total != credit_total: raise AssertionError("Converted multi-line foreign-currency journal is not balanced")
        if credit_total != money(principal * RATE): raise AssertionError("Loan principal base-currency value is incorrect")
        if sorted(Decimal(line.original_amount) for line in split_lines) != sorted([net, fee, principal]): raise AssertionError("Loan-style posting changed original foreign-currency amounts")

        explicit_original = Decimal("25.00"); explicit_base = money(explicit_original * RATE)
        explicit = post_journal(
            db,
            organization_id=organization_id,
            user_id=user_id,
            entry_date=date(2098, 1, 12),
            source_type="verify_multicurrency_explicit",
            source_id=f"explicit-{marker}",
            lines=[
                PostingLine(ledger_account_id=cash.id, debit=explicit_base, currency=foreign_currency, exchange_rate_to_base=RATE, original_amount=explicit_original),
                PostingLine(ledger_account_id=revenue.id, credit=explicit_base, currency=foreign_currency, exchange_rate_to_base=RATE, original_amount=explicit_original),
            ],
            reference=f"MC-EXPLICIT-{marker}",
        )
        explicit_total = db.scalar(select(func.coalesce(func.sum(JournalLine.debit), 0)).where(JournalLine.organization_id == organization_id, JournalLine.journal_entry_id == explicit.id))
        if money(Decimal(explicit_total or 0)) != explicit_base: raise AssertionError("Explicit base-currency posting was unexpectedly modified")

        try:
            post_journal(
                db,
                organization_id=organization_id,
                user_id=user_id,
                entry_date=date(2098, 1, 13),
                source_type="verify_multicurrency_missing_rate",
                source_id=f"missing-{marker}",
                lines=[PostingLine(ledger_account_id=cash.id, debit=Decimal("10"), currency="XZZ"), PostingLine(ledger_account_id=revenue.id, credit=Decimal("10"), currency="XZZ")],
            )
        except HTTPException as exc:
            if exc.status_code != 409 or "exchange rate is missing" not in str(exc.detail).lower(): raise AssertionError(f"Unexpected missing-rate failure: {exc.detail}") from exc
        else:
            raise AssertionError("Missing foreign exchange rate must block accounting posting")

        print("accounting multi-currency verification passed: dated FX -> source amount preserved -> base conversion -> rounding balance -> missing-rate protection")
    finally:
        db.rollback(); db.close()


if __name__ == "__main__":
    main()
