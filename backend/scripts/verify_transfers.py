from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.accounting import trial_balance
from app.api.v1.accounting_reports import financial_statements
from app.api.v1.finance import create_account
from app.api.v1.finance_transfers import record_transfer
from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction
from app.schemas.finance import AccountTransferCreate, FinancialAccountCreate
from app.services.accounting_posting import financial_ledger_account
from app.services.activity_log import record_activity
from app.services.exchange_rates import record_rate_snapshot
from app.services.operational_posting import post_financial_account_opening, post_transfer


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


def make_request(method: str, path: str) -> Request:
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


def expect_http_error(expected_status: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise AssertionError(f"Expected HTTP {expected_status}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {expected_status}, but request succeeded")


def balance(db, account: FinancialAccount) -> Decimal:
    credits = db.scalar(select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "credit",
    )) or Decimal("0")
    debits = db.scalar(select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "debit",
    )) or Decimal("0")
    return Decimal(account.opening_balance) + Decimal(credits) - Decimal(debits)


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        transfer_prefix = connection.execute(text("""
            SELECT prefix FROM organization_document_sequences
            WHERE organization_id=:organization_id AND document_type='transfer'
        """), {"organization_id": fixture["organization_id"]}).scalar_one()
        if transfer_prefix != "TRF":
            raise AssertionError("transfer sequence was not backfilled")
        if connection.execute(text("SELECT to_regclass('public.account_transfers')")).scalar_one() is None:
            raise AssertionError("account_transfers table missing")

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
        source = db.scalar(select(FinancialAccount).where(
            FinancialAccount.organization_id == tenant.organization_id,
            FinancialAccount.name == "CI USD Bank",
        ))
        fx_target = db.scalar(select(FinancialAccount).where(
            FinancialAccount.organization_id == tenant.organization_id,
            FinancialAccount.name == "CI BDT Wallet",
        ))
        if source is None or fx_target is None:
            raise AssertionError("finance verification accounts missing")

        stage = create_account(
            FinancialAccountCreate(
                name="CI Payoneer Stage",
                account_type="wallet",
                provider_name="Payoneer",
                currency=source.currency,
            ),
            make_request("POST", "/api/v1/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        source_before = balance(db, source)
        same_currency = record_transfer(
            AccountTransferCreate(
                from_account_id=source.id,
                to_account_id=stage.id,
                source_amount=Decimal("100.00"),
                fee_amount=Decimal("3.00"),
                reference="CI-FIVERR-PAYONEER",
                notes="Simulates a same-currency withdrawal fee",
            ),
            make_request("POST", "/api/v1/finance/transfers"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if same_currency.net_source_amount != Decimal("97.00") or same_currency.destination_amount != Decimal("97.00"):
            raise AssertionError("same-currency transfer did not deduct fee from received amount")
        if same_currency.exchange_rate != Decimal("1.00000000"):
            raise AssertionError("same-currency transfer exchange rate must be 1")
        db.expire_all()
        source = db.get(FinancialAccount, source.id)
        stage = db.get(FinancialAccount, stage.id)
        if source is None or stage is None:
            raise AssertionError("transfer accounts disappeared")
        if balance(db, source) != source_before - Decimal("100.00"):
            raise AssertionError("source account was not debited by total deducted amount")
        if balance(db, stage) != Decimal("97.00"):
            raise AssertionError("destination account did not receive net same-currency amount")
        fee_tx = db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.source_type == "transfer_fee",
            FinancialTransaction.source_id == same_currency.id,
        ))
        if fee_tx is None or fee_tx.amount != Decimal("3.00") or fee_tx.direction != "debit":
            raise AssertionError("transfer fee was not posted as a separate debit")

        cross_currency = record_transfer(
            AccountTransferCreate(
                from_account_id=stage.id,
                to_account_id=fx_target.id,
                source_amount=Decimal("50.00"),
                fee_amount=Decimal("0.00"),
                destination_amount=Decimal("6125.00"),
                reference="CI-PAYONEER-BD",
                notes="Simulates actual BDT received from Payoneer",
            ),
            make_request("POST", "/api/v1/finance/transfers"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if cross_currency.exchange_rate != Decimal("122.50000000"):
            raise AssertionError(f"effective FX rate mismatch: {cross_currency.exchange_rate}")
        db.expire_all()
        stage = db.get(FinancialAccount, stage.id)
        fx_target = db.get(FinancialAccount, fx_target.id)
        if stage is None or fx_target is None:
            raise AssertionError("cross-currency accounts disappeared")
        if balance(db, stage) != Decimal("47.00"):
            raise AssertionError("cross-currency source balance mismatch")
        fx_credit = db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.account_id == fx_target.id,
            FinancialTransaction.source_type == "transfer",
            FinancialTransaction.source_id == cross_currency.id,
            FinancialTransaction.direction == "credit",
        ))
        if fx_credit is None or fx_credit.amount != Decimal("6125.00"):
            raise AssertionError("cross-currency destination credit mismatch")

        expect_http_error(409, lambda: record_transfer(
            AccountTransferCreate(
                from_account_id=stage.id,
                to_account_id=fx_target.id,
                source_amount=Decimal("999999.00"),
                destination_amount=Decimal("1.00"),
            ),
            make_request("POST", "/api/v1/finance/transfers"),
            db,
            tenant,  # type: ignore[arg-type]
        ))
        db.rollback()

        persisted = db.scalar(select(AccountTransfer).where(AccountTransfer.id == cross_currency.id))
        if persisted is None or not persisted.transfer_number.startswith("TRF-"):
            raise AssertionError("transfer record/number was not persisted")

        # Accounting regression: moving foreign cash must remove the source at
        # its carrying value, not at the transfer-date spot rate. Otherwise a
        # fully emptied foreign account can retain a phantom GL balance.
        marker = uuid4().hex[:8]
        base_currency = tenant.organization.currency.upper()
        foreign_currency = "USD" if base_currency != "USD" else "EUR"
        opening_date = date(2097, 1, 1)
        transfer_date = date(2097, 2, 1)
        reversal_date = date(2097, 2, 2)
        record_rate_snapshot(
            db,
            organization_id=tenant.organization_id,
            base_currency=foreign_currency,
            quote_currency=base_currency,
            effective_date=opening_date,
            reference_rate=Decimal("120.00000000"),
            effective_rate=Decimal("120.00000000"),
            source="ci_transfer_integrity",
            user_id=tenant.user_id,
        )
        record_rate_snapshot(
            db,
            organization_id=tenant.organization_id,
            base_currency=foreign_currency,
            quote_currency=base_currency,
            effective_date=transfer_date,
            reference_rate=Decimal("125.00000000"),
            effective_rate=Decimal("125.00000000"),
            source="ci_transfer_integrity",
            user_id=tenant.user_id,
        )
        record_activity(
            db,
            action="verification.transfer.fx_seeded",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization",
            entity_id=tenant.organization_id,
            after={"currency": foreign_currency, "opening_rate": "120", "transfer_rate": "125"},
            message="Seeded FX rates for transfer carrying-value verification",
        )
        db.commit()

        fx_source = create_account(
            FinancialAccountCreate(
                name=f"CI Transfer FX Source {marker}",
                account_type="wallet",
                currency=foreign_currency,
                opening_balance=Decimal("100.00"),
            ),
            make_request("POST", "/api/v1/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        base_destination = create_account(
            FinancialAccountCreate(
                name=f"CI Transfer Base Destination {marker}",
                account_type="bank",
                currency=base_currency,
                opening_balance=Decimal("0.00"),
            ),
            make_request("POST", "/api/v1/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        post_financial_account_opening(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            account=db.get(FinancialAccount, fx_source.id),
            entry_date=opening_date,
        )
        record_activity(
            db,
            action="verification.transfer.opening_posted",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="financial_account",
            entity_id=fx_source.id,
            after={"currency": foreign_currency, "opening_balance": "100.00", "rate": "120"},
            message="Posted foreign-currency opening balance for transfer verification",
        )
        db.commit()

        accounting_transfer = record_transfer(
            AccountTransferCreate(
                from_account_id=fx_source.id,
                to_account_id=base_destination.id,
                transfer_date=transfer_date,
                source_amount=Decimal("100.00"),
                fee_amount=Decimal("0.00"),
                destination_amount=Decimal("12500.00"),
                reference=f"CI-FX-CARRY-{marker}",
            ),
            make_request("POST", "/api/v1/finance/transfers"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        transfer_row = db.scalar(
            select(AccountTransfer).where(
                AccountTransfer.id == accounting_transfer.id,
                AccountTransfer.organization_id == tenant.organization_id,
            )
        )
        if transfer_row is None:
            raise AssertionError("accounting transfer fixture missing")
        transfer_journal = post_transfer(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            transfer=transfer_row,
        )
        record_activity(
            db,
            action="verification.transfer.accounting_posted",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="account_transfer",
            entity_id=transfer_row.id,
            after={"journal_entry_id": transfer_journal.id, "reference": transfer_row.reference},
            message="Posted cross-currency transfer accounting verification journal",
        )
        db.commit()

        transfer_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key, LedgerAccount.category)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == transfer_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        source_key = f"financial_account:{fx_source.id}"
        destination_key = f"financial_account:{base_destination.id}"
        source_credit = sum(
            (Decimal(line.credit) for line, key, _ in transfer_lines if key == source_key),
            Decimal("0"),
        )
        destination_debit = sum(
            (Decimal(line.debit) for line, key, _ in transfer_lines if key == destination_key),
            Decimal("0"),
        )
        fx_gain = sum(
            (Decimal(line.credit) for line, key, _ in transfer_lines if key == "realized_fx_gain"),
            Decimal("0"),
        )
        if source_credit != Decimal("12000.00"):
            raise AssertionError(
                f"foreign transfer did not remove source cash at carrying value; got {source_credit}"
            )
        if destination_debit != Decimal("12500.00"):
            raise AssertionError(
                f"base-currency destination GL does not match actual amount received; got {destination_debit}"
            )
        if fx_gain != Decimal("500.00"):
            raise AssertionError(f"foreign cash transfer should realize 500.00 FX gain, got {fx_gain}")
        if any(
            category in {"income", "expense"}
            and key not in {"realized_fx_gain", "realized_fx_loss", "bank_fees"}
            for _, key, category in transfer_lines
        ):
            raise AssertionError("transfer principal was incorrectly classified as ordinary income/expense")

        _, source_ledger = financial_ledger_account(db, tenant.organization_id, fx_source.id)
        _, destination_ledger = financial_ledger_account(db, tenant.organization_id, base_destination.id)
        source_gl = Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0))
                .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
                .where(
                    JournalLine.organization_id == tenant.organization_id,
                    JournalLine.ledger_account_id == source_ledger.id,
                    JournalEntry.organization_id == tenant.organization_id,
                    JournalEntry.status == "posted",
                )
            )
            or 0
        )
        destination_gl = Decimal(
            db.scalar(
                select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0))
                .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
                .where(
                    JournalLine.organization_id == tenant.organization_id,
                    JournalLine.ledger_account_id == destination_ledger.id,
                    JournalEntry.organization_id == tenant.organization_id,
                    JournalEntry.status == "posted",
                )
            )
            or 0
        )
        if source_gl != Decimal("0.00"):
            raise AssertionError(f"fully transferred foreign source retained phantom GL value {source_gl}")
        if destination_gl != Decimal("12500.00"):
            raise AssertionError(f"base destination GL mismatch after transfer: {destination_gl}")

        # Same-currency own-account principal carries its historical basis across
        # accounts and must not create revenue/expense merely because spot moved.
        same_source = create_account(
            FinancialAccountCreate(
                name=f"CI Transfer Same Source {marker}",
                account_type="wallet",
                currency=foreign_currency,
                opening_balance=Decimal("100.00"),
            ),
            make_request("POST", "/api/v1/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        same_destination = create_account(
            FinancialAccountCreate(
                name=f"CI Transfer Same Destination {marker}",
                account_type="bank",
                currency=foreign_currency,
                opening_balance=Decimal("0.00"),
            ),
            make_request("POST", "/api/v1/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        post_financial_account_opening(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            account=db.get(FinancialAccount, same_source.id),
            entry_date=opening_date,
        )
        record_activity(
            db,
            action="verification.transfer.opening_posted",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="financial_account",
            entity_id=same_source.id,
            after={"currency": foreign_currency, "opening_balance": "100.00", "rate": "120"},
            message="Posted same-currency transfer opening balance verification journal",
        )
        db.commit()
        same_transfer = record_transfer(
            AccountTransferCreate(
                from_account_id=same_source.id,
                to_account_id=same_destination.id,
                transfer_date=transfer_date,
                source_amount=Decimal("100.00"),
                destination_amount=Decimal("100.00"),
                reference=f"CI-SAME-CARRY-{marker}",
            ),
            make_request("POST", "/api/v1/finance/transfers"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        same_transfer_row = db.scalar(
            select(AccountTransfer).where(
                AccountTransfer.id == same_transfer.id,
                AccountTransfer.organization_id == tenant.organization_id,
            )
        )
        if same_transfer_row is None:
            raise AssertionError("same-currency accounting transfer fixture missing")
        same_journal = post_transfer(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            transfer=same_transfer_row,
        )
        record_activity(
            db,
            action="verification.transfer.accounting_posted",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="account_transfer",
            entity_id=same_transfer_row.id,
            after={"journal_entry_id": same_journal.id, "reference": same_transfer_row.reference},
            message="Posted same-currency transfer accounting verification journal",
        )
        db.commit()
        same_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == same_journal.id,
                LedgerAccount.organization_id == tenant.organization_id,
            )
        ).all()
        if any(key in {"realized_fx_gain", "realized_fx_loss"} for _, key in same_lines):
            raise AssertionError("same-currency own-account transfer principal incorrectly realized FX")
        same_destination_key = f"financial_account:{same_destination.id}"
        carried = sum(
            (Decimal(line.debit) for line, key in same_lines if key == same_destination_key),
            Decimal("0"),
        )
        if carried != Decimal("12000.00"):
            raise AssertionError(f"same-currency transfer did not preserve carrying basis: {carried}")

        reverse_business_transaction(
            CorrectionRequest(
                source_type="transfer",
                source_id=accounting_transfer.id,
                reason="CI cross-currency transfer correction",
                reversal_date=reversal_date,
            ),
            make_request("POST", "/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        restored_source = db.get(FinancialAccount, fx_source.id)
        restored_destination = db.get(FinancialAccount, base_destination.id)
        if restored_source is None or restored_destination is None:
            raise AssertionError("transfer reversal accounts missing")
        if balance(db, restored_source) != Decimal("100.00"):
            raise AssertionError("transfer reversal did not restore source account quantity")
        if balance(db, restored_destination) != Decimal("0.00"):
            raise AssertionError("transfer reversal did not restore destination account quantity")

        trial = trial_balance(db, tenant, as_of=reversal_date)  # type: ignore[arg-type]
        if trial.total_debit != trial.total_credit:
            raise AssertionError("trial balance became unbalanced after transfer correction")
        statements = financial_statements(
            db,
            tenant,  # type: ignore[arg-type]
            date_from=opening_date,
            date_to=reversal_date,
        )
        if statements.net_profit != statements.total_income - statements.total_expenses:
            raise AssertionError("P&L does not reconcile after transfer correction")
        if statements.total_assets != statements.total_liabilities_and_equity:
            raise AssertionError("balance sheet does not balance after transfer correction")
    finally:
        db.close()

    print("finance transfer verification passed: operational balances + carrying value + realized FX + same-currency basis + correction + reports")


if __name__ == "__main__":
    main()
