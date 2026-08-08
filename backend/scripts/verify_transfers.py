from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.finance import create_account
from app.api.v1.finance_transfers import record_transfer
from app.db.session import SessionLocal, engine
from app.models.finance import AccountTransfer, FinancialAccount, FinancialTransaction
from app.schemas.finance import AccountTransferCreate, FinancialAccountCreate


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
    credits = db.scalar(select(text("COALESCE(SUM(amount), 0)")).select_from(FinancialTransaction).where(
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "credit",
    )) or Decimal("0")
    debits = db.scalar(select(text("COALESCE(SUM(amount), 0)")).select_from(FinancialTransaction).where(
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
    finally:
        db.close()

    print("finance transfer fee and FX ledger verification passed")


if __name__ == "__main__":
    main()
