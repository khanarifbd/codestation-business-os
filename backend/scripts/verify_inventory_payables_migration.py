"""Backfill regression using a disposable LOCAL database, never the shared QA schema."""
import os
import subprocess
import sys
from datetime import date
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import create_engine, text, select, func
from sqlalchemy.orm import Session
from app.db.session import engine


def seed_legacy():
    from app.models.user import User
    from app.models.organization import Organization
    from app.models.inventory import Warehouse, PurchaseReceipt
    from app.models.accounting import LedgerAccount
    from app.services.accounting_posting import ensure_default_chart, post_journal, PostingLine, system_account
    from app.services.functional_currency import ensure_initial_functional_currency_period
    with Session(engine) as db:
        u = User(email="migration-inventory@example.test", full_name="Synthetic Migration")
        db.add(u); db.flush()
        o = Organization(name="Synthetic Migration", slug="synthetic-inventory-migration", currency="USD", created_by_user_id=u.id)
        db.add(o); db.flush()
        ensure_default_chart(db, o.id, u.id)
        ensure_initial_functional_currency_period(db, o, u.id)
        w = Warehouse(organization_id=o.id, code="QA", name="QA", created_by_user_id=u.id)
        a = LedgerAccount(organization_id=o.id, code="1450", name="Inventory", category="asset", normal_balance="debit", system_key="inventory_asset")
        db.add_all([w,a]); db.flush()
        r = PurchaseReceipt(organization_id=o.id, receipt_number="PR-LEGACY", supplier_name="Synthetic Supplier", warehouse_id=w.id, receipt_date=date.today(), currency="USD", base_currency="USD", exchange_rate_to_base=1, subtotal=60, tax_total=6, recoverable_tax_total=6, total=66, amount_paid=0, balance_due=66, created_by_user_id=u.id)
        db.add(r); db.flush()
        ap = system_account(db, o.id, "accounts_payable")
        post_journal(db, organization_id=o.id, user_id=u.id, entry_date=date.today(), source_type="inventory_purchase_receipt", source_id=r.id, lines=[PostingLine(ledger_account_id=a.id, debit=Decimal("66"),currency="USD"),PostingLine(ledger_account_id=ap.id,credit=Decimal("66"),currency="USD")])
        from app.services.activity_log import record_activity
        record_activity(db, action="qa.inventory.legacy_fixture", scope="tenant", actor_user_id=u.id, organization_id=o.id, entity_type="purchase_receipt", entity_id=r.id)
        db.commit()


def verify_backfill():
    from app.models.payables import PayableBill
    from app.models.inventory import PurchaseReceipt
    from app.models.accounting import JournalEntry
    with Session(engine) as db:
        r = db.scalar(select(PurchaseReceipt))
        b = db.scalar(select(PayableBill))
        assert b.purchase_receipt_id == r.id and b.bill_number == "PR-LEGACY"
        assert b.balance_due == 66 and b.input_tax_amount == 6 and b.recoverable_tax_amount == 6
        assert db.scalar(select(func.count()).select_from(PayableBill)) == 1
        assert db.scalar(select(func.count()).select_from(JournalEntry)) == 1
    print("PASS QA-002 migration: legacy receipt backfilled exactly once, tax/balance retained, journal untouched")


def main():
    assert engine.url.host in {"localhost", "127.0.0.1", "::1"}, "Local database only"
    name = "inventory_migration_qa_" + uuid4().hex[:12]
    admin = create_engine(engine.url.set(database="postgres"), isolation_level="AUTOCOMMIT", connect_args={"client_encoding": "UTF8"})
    env = dict(os.environ, DATABASE_URL=engine.url.set(database=name).render_as_string(hide_password=False))
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name} TEMPLATE template0 ENCODING 'UTF8'"))
    try:
        for args in (["-m", "alembic", "upgrade", "0094_hr_gps_attendance"], [__file__, "seed"], ["-m", "alembic", "upgrade", "head"], [__file__, "verify"]):
            subprocess.run([sys.executable, *args], env=env, check=True)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        {"seed": seed_legacy, "verify": verify_backfill}[sys.argv[1]]()
    else:
        main()
