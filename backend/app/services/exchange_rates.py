from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy import select

from app.models.company_defaults import OrganizationExchangeRate, OrganizationExchangeRateHistory

RATE = Decimal("0.00000001")


def rate(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(RATE, rounding=ROUND_HALF_UP)


def record_rate_snapshot(
    db,
    *,
    organization_id: str,
    base_currency: str,
    quote_currency: str,
    effective_date: date,
    effective_rate: Decimal,
    reference_rate: Decimal | None,
    source: str,
    user_id: str | None = None,
) -> OrganizationExchangeRateHistory:
    base = base_currency.upper()
    quote = quote_currency.upper()
    resolved = Decimal(effective_rate)
    if base == quote or resolved <= 0:
        raise HTTPException(status_code=400, detail="Historical FX snapshot requires two different currencies and a positive rate")

    row = db.scalar(
        select(OrganizationExchangeRateHistory).where(
            OrganizationExchangeRateHistory.organization_id == organization_id,
            OrganizationExchangeRateHistory.base_currency == base,
            OrganizationExchangeRateHistory.quote_currency == quote,
            OrganizationExchangeRateHistory.effective_date == effective_date,
        )
    )
    if row is None:
        row = OrganizationExchangeRateHistory(
            organization_id=organization_id,
            base_currency=base,
            quote_currency=quote,
            effective_date=effective_date,
            reference_rate=reference_rate,
            effective_rate=resolved,
            source=source,
            created_by_user_id=user_id,
        )
        db.add(row)
    else:
        row.reference_rate = reference_rate
        row.effective_rate = resolved
        row.source = source
        if user_id is not None:
            row.created_by_user_id = user_id
    db.flush()
    return row


def _historical_row(db, organization_id: str, base: str, quote: str, as_of: date):
    return db.scalar(
        select(OrganizationExchangeRateHistory)
        .where(
            OrganizationExchangeRateHistory.organization_id == organization_id,
            OrganizationExchangeRateHistory.base_currency == base,
            OrganizationExchangeRateHistory.quote_currency == quote,
            OrganizationExchangeRateHistory.effective_date <= as_of,
        )
        .order_by(OrganizationExchangeRateHistory.effective_date.desc(), OrganizationExchangeRateHistory.updated_at.desc())
        .limit(1)
    )


def resolve_exchange_rate(
    db,
    *,
    organization_id: str,
    source_currency: str,
    target_currency: str,
    as_of: date | None = None,
) -> Decimal:
    source = source_currency.upper()
    target = target_currency.upper()
    if source == target:
        return Decimal("1.00000000")

    if as_of is not None:
        direct = _historical_row(db, organization_id, source, target, as_of)
        if direct is not None:
            return rate(direct.effective_rate)
        inverse = _historical_row(db, organization_id, target, source, as_of)
        if inverse is not None:
            inverse_rate = Decimal(inverse.effective_rate)
            if inverse_rate > 0:
                return rate(Decimal("1") / inverse_rate)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Historical accounting exchange rate is missing for {source}/{target} on or before {as_of.isoformat()}. "
                "Add an effective-dated rate in Company Settings → Currencies & FX before posting this transaction."
            ),
        )

    direct = db.scalar(
        select(OrganizationExchangeRate).where(
            OrganizationExchangeRate.organization_id == organization_id,
            OrganizationExchangeRate.base_currency == source,
            OrganizationExchangeRate.quote_currency == target,
        )
    )
    if direct is not None:
        return rate(direct.effective_rate)
    inverse = db.scalar(
        select(OrganizationExchangeRate).where(
            OrganizationExchangeRate.organization_id == organization_id,
            OrganizationExchangeRate.base_currency == target,
            OrganizationExchangeRate.quote_currency == source,
        )
    )
    if inverse is not None and Decimal(inverse.effective_rate) > 0:
        return rate(Decimal("1") / Decimal(inverse.effective_rate))
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Accounting exchange rate is missing for {source}/{target}. Add the currency pair in Company Settings → Currencies & FX.",
    )
