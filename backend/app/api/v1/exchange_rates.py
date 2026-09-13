import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.error import URLError
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.models.company_defaults import OrganizationExchangeRate, OrganizationExchangeRateHistory, OrganizationSystemDefaults
from app.schemas.exchange_rates import (
    ExchangeRateBundle,
    ExchangeRateCreate,
    ExchangeRateHistoryCreate,
    ExchangeRateHistoryRead,
    ExchangeRatePolicyRead,
    ExchangeRatePolicyUpdate,
    ExchangeRateRead,
    ExchangeRateUpdate,
)
from app.services.activity_log import record_activity
from app.services.exchange_rates import record_rate_snapshot
from app.services.functional_currency import organization_local_date

router = APIRouter(prefix="/company-settings/exchange-rates", tags=["Company Settings"])


def _defaults(db: DbSession, organization_id: str) -> OrganizationSystemDefaults:
    item = db.scalar(select(OrganizationSystemDefaults).where(OrganizationSystemDefaults.organization_id == organization_id))
    if item is None:
        raise HTTPException(status_code=500, detail="Company system defaults are missing. Run the latest database migrations.")
    return item


def _policy(item: OrganizationSystemDefaults) -> ExchangeRatePolicyRead:
    return ExchangeRatePolicyRead(
        mode=item.exchange_rate_mode,
        provider=item.exchange_rate_provider,
        adjustment_percent=item.exchange_rate_adjustment_percent,
        sync_frequency=item.exchange_rate_sync_frequency,
        last_synced_at=item.exchange_rate_last_synced_at,
    )


def _history(db: DbSession, organization_id: str) -> list[ExchangeRateHistoryRead]:
    rows = db.scalars(
        select(OrganizationExchangeRateHistory)
        .where(OrganizationExchangeRateHistory.organization_id == organization_id)
        .order_by(
            OrganizationExchangeRateHistory.effective_date.desc(),
            OrganizationExchangeRateHistory.updated_at.desc(),
        )
        .limit(200)
    ).all()
    return [ExchangeRateHistoryRead.model_validate(row) for row in rows]


def _bundle(db: DbSession, organization_id: str, defaults: OrganizationSystemDefaults) -> ExchangeRateBundle:
    rows = db.scalars(
        select(OrganizationExchangeRate)
        .where(OrganizationExchangeRate.organization_id == organization_id)
        .order_by(OrganizationExchangeRate.base_currency, OrganizationExchangeRate.quote_currency)
    ).all()
    return ExchangeRateBundle(
        policy=_policy(defaults),
        rates=[ExchangeRateRead.model_validate(row) for row in rows],
        history=_history(db, organization_id),
    )


def _effective(reference: Decimal, adjustment: Decimal) -> Decimal:
    return (reference * (Decimal("1") + adjustment / Decimal("100"))).quantize(Decimal("0.0000000001"))


def _fetch_frankfurter(base: str, quote: str) -> Decimal:
    base = base.upper()
    quote = quote.upper()
    url = f"https://api.frankfurter.dev/v2/rate/{base}/{quote}"
    try:
        req = UrlRequest(url, headers={"User-Agent": "CodeStation-Business-OS/1.0", "Accept": "application/json"})
        with urlopen(req, timeout=10) as response:  # nosec B310 - fixed HTTPS provider host
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("base") != base or payload.get("quote") != quote:
            raise ValueError("currency pair mismatch")
        value = payload.get("rate")
        if value is None:
            raise ValueError("rate missing")
        rate = Decimal(str(value))
        if rate <= 0:
            raise ValueError("rate must be positive")
        return rate
    except (URLError, TimeoutError, ValueError, InvalidOperation, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Live exchange-rate provider is temporarily unavailable for {base}/{quote}. Please try again shortly or switch to Manual mode.",
        ) from exc


@router.get("", response_model=ExchangeRateBundle)
def get_exchange_rates(db: DbSession, tenant: CurrentTenantAdmin) -> ExchangeRateBundle:
    return _bundle(db, tenant.organization_id, _defaults(db, tenant.organization_id))


@router.patch("/policy", response_model=ExchangeRatePolicyRead)
def update_policy(payload: ExchangeRatePolicyUpdate, request: Request, db: DbSession, tenant: CurrentTenantAdmin) -> ExchangeRatePolicyRead:
    item = _defaults(db, tenant.organization_id)
    before = _policy(item).model_dump(mode="json")
    item.exchange_rate_mode = payload.mode
    item.exchange_rate_provider = payload.provider
    item.exchange_rate_adjustment_percent = payload.adjustment_percent
    item.exchange_rate_sync_frequency = payload.sync_frequency
    record_activity(db, action="company.exchange_rate_policy.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="organization_system_defaults", entity_id=item.id, before=before, after=_policy(item).model_dump(mode="json"), message="Exchange rate policy updated", request=request)
    db.commit(); db.refresh(item)
    return _policy(item)


@router.post("", response_model=ExchangeRateRead, status_code=201)
def create_rate(payload: ExchangeRateCreate, request: Request, db: DbSession, tenant: CurrentTenantAdmin) -> ExchangeRateRead:
    defaults = _defaults(db, tenant.organization_id)
    base, quote = payload.base_currency.upper(), payload.quote_currency.upper()
    if base == quote:
        raise HTTPException(status_code=422, detail="Base and quote currencies must be different.")
    existing = db.scalar(select(OrganizationExchangeRate).where(OrganizationExchangeRate.organization_id == tenant.organization_id, OrganizationExchangeRate.base_currency == base, OrganizationExchangeRate.quote_currency == quote))
    if existing:
        raise HTTPException(status_code=409, detail="This currency pair already exists.")
    if defaults.exchange_rate_mode == "manual":
        if payload.manual_rate is None:
            raise HTTPException(status_code=422, detail="Manual rate is required while Manual mode is active.")
        reference, effective, source = None, payload.manual_rate, "manual"
    else:
        reference = _fetch_frankfurter(base, quote)
        effective = _effective(reference, defaults.exchange_rate_adjustment_percent if defaults.exchange_rate_mode == "automatic_adjusted" else Decimal("0"))
        source = defaults.exchange_rate_provider
    now = datetime.now(timezone.utc)
    row = OrganizationExchangeRate(organization_id=tenant.organization_id, base_currency=base, quote_currency=quote, reference_rate=reference, manual_rate=payload.manual_rate, effective_rate=effective, source=source, synced_at=now if reference else None)
    db.add(row); db.flush()
    snapshot = record_rate_snapshot(
        db,
        organization_id=tenant.organization_id,
        base_currency=base,
        quote_currency=quote,
        effective_date=organization_local_date(tenant.organization),
        reference_rate=reference,
        effective_rate=effective,
        source=source,
        user_id=tenant.user_id,
    )
    record_activity(db, action="company.exchange_rate.created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="organization_exchange_rate", entity_id=row.id, after={**ExchangeRateRead.model_validate(row).model_dump(mode="json"), "history_id": snapshot.id, "effective_date": snapshot.effective_date.isoformat()}, message=f"Exchange rate {base}/{quote} created", request=request)
    db.commit(); db.refresh(row)
    return ExchangeRateRead.model_validate(row)


@router.patch("/{rate_id}", response_model=ExchangeRateRead)
def update_manual_rate(rate_id: str, payload: ExchangeRateUpdate, request: Request, db: DbSession, tenant: CurrentTenantAdmin) -> ExchangeRateRead:
    defaults = _defaults(db, tenant.organization_id)
    if defaults.exchange_rate_mode != "manual":
        raise HTTPException(status_code=409, detail="Switch Exchange Rate Mode to Manual before editing a rate directly.")
    row = db.scalar(select(OrganizationExchangeRate).where(OrganizationExchangeRate.id == rate_id, OrganizationExchangeRate.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(status_code=404, detail="Exchange rate not found.")
    before = ExchangeRateRead.model_validate(row).model_dump(mode="json")
    row.manual_rate = payload.manual_rate; row.effective_rate = payload.manual_rate; row.source = "manual"; row.synced_at = None
    snapshot = record_rate_snapshot(
        db,
        organization_id=tenant.organization_id,
        base_currency=row.base_currency,
        quote_currency=row.quote_currency,
        effective_date=organization_local_date(tenant.organization),
        reference_rate=None,
        effective_rate=payload.manual_rate,
        source="manual",
        user_id=tenant.user_id,
    )
    record_activity(db, action="company.exchange_rate.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="organization_exchange_rate", entity_id=row.id, before=before, after={**ExchangeRateRead.model_validate(row).model_dump(mode="json"), "history_id": snapshot.id, "effective_date": snapshot.effective_date.isoformat()}, message=f"Exchange rate {row.base_currency}/{row.quote_currency} updated", request=request)
    db.commit(); db.refresh(row)
    return ExchangeRateRead.model_validate(row)


@router.post("/history", response_model=ExchangeRateHistoryRead, status_code=201)
def add_historical_rate(payload: ExchangeRateHistoryCreate, request: Request, db: DbSession, tenant: CurrentTenantAdmin) -> ExchangeRateHistoryRead:
    base, quote = payload.base_currency.upper(), payload.quote_currency.upper()
    if base == quote:
        raise HTTPException(status_code=422, detail="Base and quote currencies must be different.")
    if payload.effective_date > organization_local_date(tenant.organization):
        raise HTTPException(status_code=422, detail="Historical accounting FX rate cannot have a future effective date.")
    pair = db.scalar(select(OrganizationExchangeRate.id).where(OrganizationExchangeRate.organization_id == tenant.organization_id, OrganizationExchangeRate.base_currency == base, OrganizationExchangeRate.quote_currency == quote))
    inverse = db.scalar(select(OrganizationExchangeRate.id).where(OrganizationExchangeRate.organization_id == tenant.organization_id, OrganizationExchangeRate.base_currency == quote, OrganizationExchangeRate.quote_currency == base))
    if pair is None and inverse is None:
        raise HTTPException(status_code=409, detail="Add the currency pair first, then record historical accounting rates for it.")
    row = record_rate_snapshot(
        db,
        organization_id=tenant.organization_id,
        base_currency=base,
        quote_currency=quote,
        effective_date=payload.effective_date,
        reference_rate=None,
        effective_rate=payload.effective_rate,
        source="manual_historical",
        user_id=tenant.user_id,
    )
    record_activity(db, action="company.exchange_rate_history.recorded", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="organization_exchange_rate_history", entity_id=row.id, after=ExchangeRateHistoryRead.model_validate(row).model_dump(mode="json"), message=f"Historical exchange rate {base}/{quote} recorded for {payload.effective_date.isoformat()}", request=request)
    db.commit(); db.refresh(row)
    return ExchangeRateHistoryRead.model_validate(row)


@router.post("/sync", response_model=ExchangeRateBundle)
def sync_rates(request: Request, db: DbSession, tenant: CurrentTenantAdmin) -> ExchangeRateBundle:
    defaults = _defaults(db, tenant.organization_id)
    if defaults.exchange_rate_mode == "manual":
        raise HTTPException(status_code=409, detail="Live sync is disabled while Manual mode is active.")
    rows = db.scalars(select(OrganizationExchangeRate).where(OrganizationExchangeRate.organization_id == tenant.organization_id).order_by(OrganizationExchangeRate.base_currency, OrganizationExchangeRate.quote_currency)).all()
    if not rows:
        raise HTTPException(status_code=409, detail="Add at least one currency pair before syncing live exchange rates.")
    now = datetime.now(timezone.utc)
    business_date = organization_local_date(tenant.organization, now)
    adjustment = defaults.exchange_rate_adjustment_percent if defaults.exchange_rate_mode == "automatic_adjusted" else Decimal("0")
    for row in rows:
        reference = _fetch_frankfurter(row.base_currency, row.quote_currency)
        row.reference_rate = reference; row.effective_rate = _effective(reference, adjustment); row.source = defaults.exchange_rate_provider; row.synced_at = now
        record_rate_snapshot(
            db,
            organization_id=tenant.organization_id,
            base_currency=row.base_currency,
            quote_currency=row.quote_currency,
            effective_date=business_date,
            reference_rate=reference,
            effective_rate=row.effective_rate,
            source=row.source,
            user_id=tenant.user_id,
        )
    defaults.exchange_rate_last_synced_at = now
    record_activity(db, action="company.exchange_rates.synced", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="organization_system_defaults", entity_id=defaults.id, after={"pairs": len(rows), "provider": defaults.exchange_rate_provider, "synced_at": now.isoformat(), "effective_date": business_date.isoformat(), "rates": [{"pair": f"{row.base_currency}/{row.quote_currency}", "reference_rate": str(row.reference_rate), "effective_rate": str(row.effective_rate)} for row in rows]}, message="Exchange rates synced and accounting-date snapshots recorded", request=request)
    db.commit()
    return _bundle(db, tenant.organization_id, defaults)
