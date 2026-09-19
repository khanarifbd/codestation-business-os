from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.accounting_assets import AssetCreate, DepreciationRun, create_asset, run_depreciation
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.fixed_assets import AssetDepreciationEntry, FixedAsset
from app.services.activity_log import record_activity


@dataclass(frozen=True)
class Org:
    id: str
    currency: str
    timezone: str = "UTC"

@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    organization: Org
    role: str = "admin"


def request(method: str, path: str) -> Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant = Tenant(str(row["organization_id"]), str(row["user_id"]), str(row["membership_id"]), Org(str(row["organization_id"]), str(row["currency"] or "BDT")))
    db=SessionLocal(); marker=uuid4().hex[:8]
    try:
        account=FinancialAccount(organization_id=tenant.organization_id,name=f"CI Asset Bank {marker}",account_type="bank",currency=tenant.organization.currency,opening_balance=Decimal("100000"),is_active=True,created_by_user_id=tenant.user_id)
        db.add(account); db.flush()
        record_activity(db,action="ci.fixed_asset.fixture.create",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="financial_account",entity_id=account.id,after={"account_id":account.id,"opening_balance":"100000.00"},request=request("POST","/ci/fixed-asset-fixture"))
        db.commit()
        asset=create_asset(AssetCreate(asset_code=f"FA-{marker}",name="CI Laptop",category="computer",currency=tenant.organization.currency,acquisition_cost=Decimal("12000"),salvage_value=Decimal("0"),acquisition_date=date(2098,1,1),in_service_date=date(2098,1,1),useful_life_months=12,record_mode="purchase",purchase_account_id=account.id,reference=f"FA-REF-{marker}"),request("POST","/accounting/assets"),db,tenant)  # type: ignore[arg-type]
        if asset["book_value"]!=Decimal("12000.00"): raise AssertionError("asset initial book value failed")
        tx=db.scalar(select(FinancialTransaction).where(FinancialTransaction.organization_id==tenant.organization_id,FinancialTransaction.source_type=="fixed_asset_acquisition",FinancialTransaction.source_id==asset["id"]))
        journal=db.scalar(select(JournalEntry).where(JournalEntry.organization_id==tenant.organization_id,JournalEntry.source_type=="fixed_asset_acquisition",JournalEntry.source_id==asset["id"],JournalEntry.status=="posted"))
        if tx is None or tx.direction!="debit" or journal is None: raise AssertionError("asset purchase cash/journal posting failed")
        result=run_depreciation(DepreciationRun(period_date=date(2098,1,31)),request("POST","/accounting/assets/depreciation"),db,tenant)  # type: ignore[arg-type]
        posted=next((x for x in result["posted"] if x["asset_id"]==asset["id"]),None)
        if posted is None or posted["amount"]!=Decimal("1000.00") or posted["book_value"]!=Decimal("11000.00"): raise AssertionError("straight-line depreciation failed")
        stored=db.scalar(select(FixedAsset).where(FixedAsset.id==asset["id"])); dep=db.scalar(select(AssetDepreciationEntry).where(AssetDepreciationEntry.asset_id==asset["id"])); dep_journal=db.scalar(select(JournalEntry).where(JournalEntry.id==dep.journal_entry_id)) if dep else None
        if stored is None or stored.accumulated_depreciation!=Decimal("1000.00") or dep_journal is None: raise AssertionError("depreciation persistence/journal failed")

        credit_card=FinancialAccount(organization_id=tenant.organization_id,name=f"CI Asset Card {marker}",account_type="credit_card",currency=tenant.organization.currency,opening_balance=Decimal("0"),is_active=True,created_by_user_id=tenant.user_id)
        db.add(credit_card); db.flush()
        try:
            create_asset(AssetCreate(asset_code=f"FA-CC-{marker}",name="CI Card Asset",category="computer",currency=tenant.organization.currency,acquisition_cost=Decimal("100"),salvage_value=Decimal("0"),acquisition_date=date(2098,2,1),in_service_date=date(2098,2,1),useful_life_months=12,record_mode="purchase",purchase_account_id=credit_card.id),request("POST","/accounting/assets"),db,tenant)  # type: ignore[arg-type]
        except HTTPException as exc:
            if exc.status_code != 400:
                raise AssertionError(f"credit-card asset purchase expected 400, got {exc.status_code}") from exc
            db.rollback()
        else:
            raise AssertionError("credit-card asset purchase must be blocked until liability-aware posting exists")

        foreign_currency = "USD" if tenant.organization.currency.upper() != "USD" else "EUR"
        fx_account=FinancialAccount(organization_id=tenant.organization_id,name=f"CI Asset FX Bank {marker}",account_type="bank",currency=foreign_currency,opening_balance=Decimal("100000"),is_active=True,created_by_user_id=tenant.user_id)
        db.add(fx_account); db.flush()
        pair_id=str(uuid4())
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO organization_exchange_rates
                    (id, organization_id, base_currency, quote_currency,
                     reference_rate, manual_rate, effective_rate, source,
                     synced_at, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :foreign_currency, :base_currency,
                     :rate, :rate, :rate, 'ci_fixed_assets',
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (organization_id, base_currency, quote_currency)
                DO UPDATE SET reference_rate=EXCLUDED.reference_rate,
                    manual_rate=EXCLUDED.manual_rate,
                    effective_rate=EXCLUDED.effective_rate,
                    source=EXCLUDED.source,
                    updated_at=CURRENT_TIMESTAMP
            """), {"id":pair_id,"organization_id":tenant.organization_id,"foreign_currency":foreign_currency,"base_currency":tenant.organization.currency.upper(),"rate":Decimal("120.00000000")})
            for effective_date, rate in ((date(2098,3,1),Decimal("100.00000000")),(date(2098,4,30),Decimal("120.00000000"))):
                conn.execute(text("""
                    INSERT INTO organization_exchange_rate_history
                        (id, organization_id, base_currency, quote_currency, effective_date,
                         reference_rate, effective_rate, source, created_by_user_id,
                         created_at, updated_at)
                    VALUES
                        (:id, :organization_id, :foreign_currency, :base_currency, :effective_date,
                         :rate, :rate, 'ci_fixed_assets', NULL,
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (organization_id, base_currency, quote_currency, effective_date)
                    DO UPDATE SET reference_rate=EXCLUDED.reference_rate,
                        effective_rate=EXCLUDED.effective_rate,
                        source=EXCLUDED.source,
                        updated_at=CURRENT_TIMESTAMP
                """), {"id":str(uuid4()),"organization_id":tenant.organization_id,"foreign_currency":foreign_currency,"base_currency":tenant.organization.currency.upper(),"effective_date":effective_date,"rate":rate})

        fx_asset=create_asset(AssetCreate(asset_code=f"FA-FX-{marker}",name="CI FX Laptop",category="computer",currency=foreign_currency,acquisition_cost=Decimal("120"),salvage_value=Decimal("0"),acquisition_date=date(2098,3,1),in_service_date=date(2098,3,1),useful_life_months=12,record_mode="purchase",purchase_account_id=fx_account.id),request("POST","/accounting/assets"),db,tenant)  # type: ignore[arg-type]
        run_depreciation(DepreciationRun(period_date=date(2098,4,30)),request("POST","/accounting/assets/depreciation"),db,tenant)  # type: ignore[arg-type]
        fx_dep=db.scalar(select(AssetDepreciationEntry).where(AssetDepreciationEntry.organization_id==tenant.organization_id,AssetDepreciationEntry.asset_id==fx_asset["id"],AssetDepreciationEntry.period_date==date(2098,4,1)))
        if fx_dep is None:
            raise AssertionError("foreign-currency depreciation entry missing")
        fx_line=db.scalar(select(JournalLine).where(JournalLine.organization_id==tenant.organization_id,JournalLine.journal_entry_id==fx_dep.journal_entry_id,JournalLine.debit>0))
        if fx_line is None or Decimal(fx_line.debit)!=Decimal("1000.00"):
            raise AssertionError(f"foreign asset depreciation must use acquisition-date historical FX; got {fx_line.debit if fx_line else None}")
    finally: db.close()
    print("fixed asset verification passed: purchase -> fixed asset journal -> straight-line depreciation -> accumulated depreciation")

if __name__=="__main__": main()
