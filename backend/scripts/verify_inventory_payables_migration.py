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
        cash = system_account(db, o.id, "cash_equivalents")
        for number, paid, status in (("PR-PARTIAL", 20, "received"), ("PR-PAID", 66, "received"), ("PR-CANCELLED", 0, "cancelled")):
            extra = PurchaseReceipt(organization_id=o.id, receipt_number=number, supplier_name="Synthetic Supplier", warehouse_id=w.id, receipt_date=date.today(), currency="USD", base_currency="USD", exchange_rate_to_base=1, subtotal=60, tax_total=6, recoverable_tax_total=6, total=66, amount_paid=paid, balance_due=66-paid, status=status, created_by_user_id=u.id)
            db.add(extra); db.flush()
            if status != "cancelled":
                post_journal(db, organization_id=o.id, user_id=u.id, entry_date=date.today(), source_type="inventory_purchase_receipt", source_id=extra.id, lines=[PostingLine(ledger_account_id=a.id,debit=Decimal("66"),currency="USD"),PostingLine(ledger_account_id=ap.id,credit=Decimal("66"),currency="USD")])
                post_journal(db, organization_id=o.id, user_id=u.id, entry_date=date.today(), source_type="legacy_inventory_settlement", source_id=extra.id, lines=[PostingLine(ledger_account_id=ap.id,debit=Decimal(paid),currency="USD"),PostingLine(ledger_account_id=cash.id,credit=Decimal(paid),currency="USD")])
        from app.services.activity_log import record_activity
        record_activity(db, action="qa.inventory.legacy_fixture", scope="tenant", actor_user_id=u.id, organization_id=o.id, entity_type="purchase_receipt", entity_id=r.id)
        db.commit()


def verify_backfill():
    from app.models.payables import PayableBill
    from app.models.inventory import PurchaseReceipt
    from app.models.accounting import JournalEntry
    with Session(engine) as db:
        rows = {b.bill_number: b for b in db.scalars(select(PayableBill)).all()}
        assert set(rows) == {"PR-LEGACY", "PR-PARTIAL", "PR-PAID"}
        for number, paid, due, status in (("PR-LEGACY", 0, 66, "open"), ("PR-PARTIAL", 20, 46, "partially_paid"), ("PR-PAID", 66, 0, "paid")):
            b = rows[number]
            r = db.get(PurchaseReceipt, b.purchase_receipt_id)
            assert r.receipt_number == number
            assert b.amount_paid == paid and b.balance_due == due and b.status == status
            assert b.input_tax_amount == b.recoverable_tax_amount == 6
        assert db.scalar(select(func.count()).select_from(JournalEntry)) == 5
    print("PASS migration: open/partial/paid balances and tax preserved; cancelled omitted; five original journals unchanged")


def settle_and_check_guard():
    from types import SimpleNamespace
    from starlette.requests import Request
    from app.models.payables import PayableBill
    from app.models.inventory import PurchaseReceipt
    from app.models.organization import Organization
    from app.models.accounting import JournalLine, LedgerAccount
    from app.api.v1.finance import create_account
    from app.api.v1.payables import pay_payable_bill
    from app.schemas.finance import FinancialAccountCreate
    from app.schemas.payables import PayablePaymentCreate
    with Session(engine) as db:
        bill = db.scalar(select(PayableBill).where(PayableBill.bill_number == "PR-PARTIAL"))
        org = db.get(Organization, bill.organization_id)
        tenant = SimpleNamespace(organization_id=org.id, organization=org, user_id=org.created_by_user_id)
        request = Request({"type":"http", "method":"POST", "path":"/qa", "headers":[]})
        account = create_account(FinancialAccountCreate(name="Migration QA Cash", account_type="cash", currency="USD", opening_balance=Decimal("100")), request, db, tenant)
        pay_payable_bill(bill.id, PayablePaymentCreate(financial_account_id=account.id, payment_date=date.today(), amount=Decimal("46")), request, db, tenant)
        assert bill.amount_paid == 66 and bill.balance_due == 0
        assert db.get(PurchaseReceipt,bill.purchase_receipt_id).balance_due == 0
        ap = db.scalar(select(LedgerAccount).where(LedgerAccount.system_key == "accounts_payable"))
        assert db.scalar(select(func.sum(JournalLine.credit-JournalLine.debit)).where(JournalLine.ledger_account_id == ap.id)) == 66
    failed = subprocess.run([sys.executable,"-m","alembic","downgrade","0094_hr_gps_attendance"], capture_output=True, text=True)
    assert failed.returncode != 0 and "Inventory payables have payments" in failed.stderr, failed.stderr
    with engine.connect() as conn:
        assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0095_inventory_payables"
        assert conn.scalar(text("SELECT count(*) FROM payable_bills WHERE purchase_receipt_id IS NOT NULL")) == 3
        assert conn.scalar(text("SELECT count(*) FROM payable_payments")) == 1
    print("PASS migration: legacy partial settlement reconciles AP; used-subledger downgrade blocked atomically, payment/bills retained")


def main():
    assert engine.url.host in {"localhost", "127.0.0.1", "::1"}, "Local database only"
    name = "inventory_migration_qa_" + uuid4().hex[:12]
    admin = create_engine(engine.url.set(database="postgres"), isolation_level="AUTOCOMMIT", connect_args={"client_encoding": "UTF8"})
    env = dict(os.environ, DATABASE_URL=engine.url.set(database=name).render_as_string(hide_password=False))
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name} TEMPLATE template0 ENCODING 'UTF8'"))
    try:
        for args in (["-m", "alembic", "upgrade", "0094_hr_gps_attendance"], [__file__, "seed"], ["-m", "alembic", "upgrade", "0095_inventory_payables"], [__file__, "verify"], ["-m", "alembic", "downgrade", "0094_hr_gps_attendance"], ["-m", "alembic", "upgrade", "0095_inventory_payables"], [__file__, "verify"], [__file__, "guard"]):
            subprocess.run([sys.executable, *args], env=env, check=True)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        {"seed": seed_legacy, "verify": verify_backfill, "guard": settle_and_check_guard}[sys.argv[1]]()
    else:
        main()
