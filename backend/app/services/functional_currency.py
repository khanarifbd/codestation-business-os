from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select

from app.models.accounting import (
    JournalEntry,
    JournalLine,
    LedgerAccount,
    OrganizationFunctionalCurrencyPeriod,
)
from app.models.company_settings import OrganizationFinancialSettings
from app.models.finance_controls import AccountingPeriod
from app.models.organization import Organization
from app.services.exchange_rates import resolve_exchange_rate

MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")
INITIAL_FUNCTIONAL_DATE = date(1900, 1, 1)


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def rate(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(RATE, rounding=ROUND_HALF_UP)


def organization_local_date(
    organization: Organization,
    now: datetime | None = None,
) -> date:
    """Resolve the business date in the organization's configured timezone."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(ZoneInfo(organization.timezone)).date()


@dataclass(frozen=True)
class FunctionalCurrencyChangeResult:
    previous_currency: str
    new_currency: str
    effective_date: date
    transition_rate: Decimal | None
    period_id: str
    transition_journal_entry_id: str | None
    opening_debit: Decimal
    opening_credit: Decimal
    synced_counts: dict[str, int]


def ensure_initial_functional_currency_period(
    db,
    organization: Organization,
    user_id: str | None = None,
) -> OrganizationFunctionalCurrencyPeriod:
    current = db.scalar(
        select(OrganizationFunctionalCurrencyPeriod)
        .where(
            OrganizationFunctionalCurrencyPeriod.organization_id == organization.id,
            OrganizationFunctionalCurrencyPeriod.effective_to.is_(None),
        )
        .order_by(OrganizationFunctionalCurrencyPeriod.effective_from.desc())
        .limit(1)
    )
    if current is not None:
        return current

    item = OrganizationFunctionalCurrencyPeriod(
        organization_id=organization.id,
        currency=organization.currency.upper(),
        effective_from=INITIAL_FUNCTIONAL_DATE,
        effective_to=None,
        previous_currency=None,
        transition_rate=None,
        reason="Initial functional currency",
        changed_by_user_id=user_id or organization.created_by_user_id,
    )
    db.add(item)
    db.flush()
    return item


def list_functional_currency_periods(db, organization_id: str) -> list[OrganizationFunctionalCurrencyPeriod]:
    return list(
        db.scalars(
            select(OrganizationFunctionalCurrencyPeriod)
            .where(OrganizationFunctionalCurrencyPeriod.organization_id == organization_id)
            .order_by(OrganizationFunctionalCurrencyPeriod.effective_from.asc())
        ).all()
    )


def current_functional_currency_period(db, organization_id: str) -> OrganizationFunctionalCurrencyPeriod:
    item = db.scalar(
        select(OrganizationFunctionalCurrencyPeriod)
        .where(
            OrganizationFunctionalCurrencyPeriod.organization_id == organization_id,
            OrganizationFunctionalCurrencyPeriod.effective_to.is_(None),
        )
        .order_by(OrganizationFunctionalCurrencyPeriod.effective_from.desc())
        .limit(1)
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Functional currency history is missing. Run the latest database migrations.",
        )
    return item


def functional_currency_period_for_date(
    db,
    organization_id: str,
    entry_date: date,
) -> OrganizationFunctionalCurrencyPeriod:
    item = db.scalar(
        select(OrganizationFunctionalCurrencyPeriod)
        .where(
            OrganizationFunctionalCurrencyPeriod.organization_id == organization_id,
            OrganizationFunctionalCurrencyPeriod.effective_from <= entry_date,
            or_(
                OrganizationFunctionalCurrencyPeriod.effective_to.is_(None),
                OrganizationFunctionalCurrencyPeriod.effective_to >= entry_date,
            ),
        )
        .order_by(OrganizationFunctionalCurrencyPeriod.effective_from.desc())
        .limit(1)
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No functional currency period is configured for {entry_date.isoformat()}.",
        )
    return item


def functional_currency_for_date(db, organization_id: str, entry_date: date) -> str:
    return functional_currency_period_for_date(db, organization_id, entry_date).currency.upper()


def assert_current_functional_posting_period(
    db,
    organization_id: str,
    entry_date: date,
) -> OrganizationFunctionalCurrencyPeriod:
    period = functional_currency_period_for_date(db, organization_id, entry_date)
    current = current_functional_currency_period(db, organization_id)
    if period.id != current.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"The functional-currency period for {entry_date.isoformat()} is sealed. "
                f"It used {period.currency}; the current accounting currency is {current.currency}. "
                "Post a current-period correction instead of adding or changing historical ledger entries."
            ),
        )
    return current


def latest_posted_journal_date(db, organization_id: str) -> date | None:
    return db.scalar(
        select(func.max(JournalEntry.entry_date)).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
        )
    )


def earliest_functional_currency_change_date(db, organization_id: str) -> date | None:
    latest = latest_posted_journal_date(db, organization_id)
    return latest + timedelta(days=1) if latest is not None else None


def _transition_rate(
    db,
    organization_id: str,
    previous_currency: str,
    new_currency: str,
    effective_date: date,
    submitted: Decimal | None,
) -> Decimal:
    if submitted is not None:
        resolved = rate(submitted)
        if resolved <= 0:
            raise HTTPException(status_code=400, detail="Transition exchange rate must be greater than zero")
        return resolved

    return resolve_exchange_rate(
        db,
        organization_id=organization_id,
        source_currency=previous_currency,
        target_currency=new_currency,
        as_of=effective_date,
    )


def _opening_equity_account(db, organization_id: str, user_id: str) -> LedgerAccount:
    item = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key == "opening_balance_equity",
        )
    )
    if item is not None:
        return item

    by_code = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.code == "3100",
        )
    )
    if by_code is not None:
        if by_code.category != "equity":
            raise HTTPException(
                status_code=409,
                detail="Ledger code 3100 exists but is not an equity account; opening-balance equity cannot be initialized.",
            )
        by_code.system_key = "opening_balance_equity"
        by_code.is_system = True
        by_code.normal_balance = "credit"
        db.flush()
        return by_code

    item = LedgerAccount(
        organization_id=organization_id,
        code="3100",
        name="Opening Balance Equity",
        category="equity",
        subtype="opening_balance_equity",
        normal_balance="credit",
        parent_id=None,
        system_key="opening_balance_equity",
        is_system=True,
        is_active=True,
        allow_manual_posting=True,
        notes="System equity account used for opening and functional-currency transition balances",
        created_by_user_id=user_id,
    )
    db.add(item)
    db.flush()
    return item


def _closing_signed_balances(
    db,
    organization_id: str,
    period: OrganizationFunctionalCurrencyPeriod,
    closing_date: date,
) -> tuple[dict[str, tuple[LedgerAccount, Decimal]], Decimal]:
    rows = db.execute(
        select(
            LedgerAccount,
            func.coalesce(func.sum(JournalLine.debit), 0).label("debit"),
            func.coalesce(func.sum(JournalLine.credit), 0).label("credit"),
        )
        .join(JournalLine, JournalLine.ledger_account_id == LedgerAccount.id)
        .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .where(
            LedgerAccount.organization_id == organization_id,
            JournalLine.organization_id == organization_id,
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
            JournalEntry.functional_currency == period.currency,
            JournalEntry.entry_date >= period.effective_from,
            JournalEntry.entry_date <= closing_date,
        )
        .group_by(LedgerAccount.id)
    ).all()

    balance_sheet: dict[str, tuple[LedgerAccount, Decimal]] = {}
    total_income = Decimal("0")
    total_expenses = Decimal("0")
    for account, debit, credit in rows:
        debit_value = Decimal(debit or 0)
        credit_value = Decimal(credit or 0)
        if account.category in {"asset", "liability", "equity"}:
            signed = money(debit_value - credit_value)
            if signed != 0:
                balance_sheet[account.id] = (account, signed)
        elif account.category == "income":
            total_income += credit_value - debit_value
        elif account.category == "expense":
            total_expenses += debit_value - credit_value

    net_profit = money(total_income - total_expenses)
    return balance_sheet, net_profit


def change_functional_currency(
    db,
    *,
    organization: Organization,
    user_id: str,
    new_currency: str,
    effective_date: date,
    transition_rate: Decimal | None,
    reason: str,
) -> FunctionalCurrencyChangeResult:
    new_currency = new_currency.upper().strip()
    reason = reason.strip()
    if len(new_currency) != 3:
        raise HTTPException(status_code=400, detail="Accounting currency must be a 3-letter currency code")
    if len(reason) < 3:
        raise HTTPException(status_code=400, detail="A reason is required for an accounting-currency change")

    organization_today = organization_local_date(organization)
    if effective_date > organization_today:
        raise HTTPException(
            status_code=409,
            detail=(
                f"The effective date cannot be after the organization's current business date "
                f"({organization_today.isoformat()} in {organization.timezone}). "
                "Future functional-currency changes are not applied early because posting must continue in the "
                "current currency until the effective date."
            ),
        )

    current = current_functional_currency_period(db, organization.id)
    previous_currency = current.currency.upper()
    if new_currency == previous_currency:
        raise HTTPException(status_code=409, detail=f"Accounting currency is already {new_currency}")
    if effective_date <= current.effective_from:
        raise HTTPException(
            status_code=409,
            detail=f"Effective date must be after the current functional-currency period start ({current.effective_from.isoformat()}).",
        )

    closed_period = db.scalar(
        select(AccountingPeriod.id).where(
            AccountingPeriod.organization_id == organization.id,
            AccountingPeriod.status == "closed",
            AccountingPeriod.start_date <= effective_date,
            AccountingPeriod.end_date >= effective_date,
        )
    )
    if closed_period is not None:
        raise HTTPException(
            status_code=409,
            detail=f"The accounting period containing {effective_date.isoformat()} is closed.",
        )

    later_period = db.scalar(
        select(OrganizationFunctionalCurrencyPeriod.id).where(
            OrganizationFunctionalCurrencyPeriod.organization_id == organization.id,
            OrganizationFunctionalCurrencyPeriod.effective_from > current.effective_from,
        ).limit(1)
    )
    if later_period is not None:
        raise HTTPException(status_code=409, detail="Functional currency history is inconsistent; a later period already exists")

    closing_date = effective_date - timedelta(days=1)
    from app.services.accounting_sync import sync_operational_accounting

    sync_result = sync_operational_accounting(
        db,
        organization_id=organization.id,
        user_id=user_id,
        base_currency=previous_currency,
        through_date=closing_date,
    )
    if sync_result["errors"]:
        sample = "; ".join(sync_result["errors"][:5])
        raise HTTPException(
            status_code=409,
            detail=(
                "Accounting currency cannot change until existing operational activity through "
                f"{closing_date.isoformat()} is synchronized cleanly. {sample}"
            ),
        )

    latest = latest_posted_journal_date(db, organization.id)
    if latest is not None and latest >= effective_date:
        raise HTTPException(
            status_code=409,
            detail=f"A posted journal exists on {latest.isoformat()}. Choose an effective date after the latest posted journal.",
        )

    resolved_rate = _transition_rate(
        db,
        organization.id,
        previous_currency,
        new_currency,
        effective_date,
        transition_rate,
    )

    financial = db.scalar(
        select(OrganizationFinancialSettings).where(
            OrganizationFinancialSettings.organization_id == organization.id
        )
    )
    if financial is None:
        raise HTTPException(status_code=500, detail="Organization financial settings are missing")

    balance_sheet, net_profit = _closing_signed_balances(
        db,
        organization.id,
        current,
        closing_date,
    )
    opening_equity = _opening_equity_account(db, organization.id, user_id)

    signed_old: dict[str, tuple[LedgerAccount, Decimal]] = dict(balance_sheet)
    existing_equity = signed_old.get(opening_equity.id, (opening_equity, Decimal("0")))[1]
    signed_old[opening_equity.id] = (opening_equity, money(existing_equity - net_profit))

    signed_new: dict[str, tuple[LedgerAccount, Decimal, Decimal]] = {}
    for account_id, (account, old_signed) in signed_old.items():
        if old_signed == 0:
            continue
        converted = money(abs(old_signed) * resolved_rate)
        if converted == 0:
            continue
        signed_new[account_id] = (
            account,
            converted if old_signed > 0 else -converted,
            old_signed,
        )

    rounding_difference = money(sum((item[1] for item in signed_new.values()), Decimal("0")))
    if rounding_difference != 0:
        existing = signed_new.get(opening_equity.id)
        if existing is None:
            signed_new[opening_equity.id] = (
                opening_equity,
                -rounding_difference,
                Decimal("0"),
            )
        else:
            signed_new[opening_equity.id] = (
                opening_equity,
                money(existing[1] - rounding_difference),
                existing[2],
            )

    current.effective_to = closing_date
    new_period = OrganizationFunctionalCurrencyPeriod(
        organization_id=organization.id,
        currency=new_currency,
        effective_from=effective_date,
        effective_to=None,
        previous_currency=previous_currency,
        transition_rate=resolved_rate,
        reason=reason,
        changed_by_user_id=user_id,
    )
    db.add(new_period)
    db.flush()

    transition_entry: JournalEntry | None = None
    opening_debit = Decimal("0")
    opening_credit = Decimal("0")
    converted_items = [item for item in signed_new.values() if item[1] != 0]
    if converted_items:
        transition_entry = JournalEntry(
            organization_id=organization.id,
            entry_number=f"FX-{effective_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}",
            entry_date=effective_date,
            functional_currency=new_currency,
            status="posted",
            source_type="functional_currency_transition",
            source_id=new_period.id,
            reference=f"{previous_currency}→{new_currency}",
            memo=(
                f"Functional currency changed from {previous_currency} to {new_currency} "
                f"at 1 {previous_currency} = {resolved_rate} {new_currency}. {reason}"
            ),
            created_by_user_id=user_id,
            posted_by_user_id=user_id,
            posted_at=datetime.now(timezone.utc),
        )
        db.add(transition_entry)
        db.flush()

        for account, signed_amount, old_signed in converted_items:
            amount = money(abs(signed_amount))
            if amount == 0:
                continue
            debit = amount if signed_amount > 0 else Decimal("0")
            credit = amount if signed_amount < 0 else Decimal("0")
            opening_debit += debit
            opening_credit += credit
            db.add(
                JournalLine(
                    organization_id=organization.id,
                    journal_entry_id=transition_entry.id,
                    ledger_account_id=account.id,
                    description=(
                        f"Functional currency opening balance; prior {previous_currency} "
                        f"signed balance {money(old_signed)} @ {resolved_rate}"
                    ),
                    currency=new_currency,
                    exchange_rate_to_base=Decimal("1.00000000"),
                    debit=debit,
                    credit=credit,
                    original_amount=amount,
                )
            )

        opening_debit = money(opening_debit)
        opening_credit = money(opening_credit)
        if opening_debit != opening_credit:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Functional-currency opening journal did not balance after rounding. "
                    "The currency change was not applied."
                ),
            )
        db.flush()
        new_period.transition_journal_entry_id = transition_entry.id

    organization.currency = new_currency
    financial.accounting_currency = new_currency
    db.flush()

    return FunctionalCurrencyChangeResult(
        previous_currency=previous_currency,
        new_currency=new_currency,
        effective_date=effective_date,
        transition_rate=resolved_rate,
        period_id=new_period.id,
        transition_journal_entry_id=transition_entry.id if transition_entry else None,
        opening_debit=opening_debit,
        opening_credit=opening_credit,
        synced_counts=dict(sync_result["counts"]),
    )
