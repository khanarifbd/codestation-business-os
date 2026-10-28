"""QA-002/008 local PostgreSQL regression; synthetic fixture rolls back."""
from datetime import date
from decimal import Decimal as D
from types import SimpleNamespace
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.requests import Request
from app.db.session import engine
from app.models.user import User
from app.models.organization import Organization
from app.models.inventory import InventoryBalance, PurchaseReceipt, StockMovement
from app.models.payables import PayableBill
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.schemas.inventory import WarehouseCreate, ProductCreate, PurchaseReceiptCreate, PurchaseLineInput, AdjustmentCreate
from app.schemas.finance import FinancialAccountCreate
from app.schemas.payables import PayablePaymentCreate
from app.api.v1.inventory import create_warehouse, create_product, receive_purchase, adjustment
from app.api.v1.finance import create_account
from app.api.v1.payables import pay_payable_bill
from app.api.v1.payables_workspace import payables_workspace
from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.services.accounting_posting import ensure_default_chart
from app.services.functional_currency import ensure_initial_functional_currency_period


def verify_foreign_inventory(db, tenant, request, warehouse):
    from datetime import timedelta
    from app.models.company_defaults import OrganizationExchangeRate
    from app.services.exchange_rates import record_rate_snapshot
    from app.models.finance import FinancialTransaction
    org = tenant.organization_id
    ap_account = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == org, LedgerAccount.system_key == "accounts_payable"))
    def total_ap():
        return db.scalar(select(func.coalesce(func.sum(JournalLine.credit-JournalLine.debit),0)).where(JournalLine.ledger_account_id == ap_account.id))
    ap_before = total_ap()
    day = date.today() - timedelta(days=2)
    db.add(OrganizationExchangeRate(organization_id=org, base_currency="EUR", quote_currency="USD", effective_rate=D("1.6")))
    for offset, rate in ((0, "1.2"), (1, "1.4"), (2, "1.1")):
        record_rate_snapshot(db, organization_id=org, base_currency="EUR", quote_currency="USD", effective_date=day + timedelta(days=offset), effective_rate=D(rate), reference_rate=None, source="synthetic_qa", user_id=tenant.user_id)
    product = create_product(ProductCreate(sku="QA-FX-STOCK", name="Synthetic EUR Stock", item_type="stock_item", currency="EUR", standard_cost=D("6")), request, db, tenant)
    result = receive_purchase(PurchaseReceiptCreate(supplier_name="Synthetic EUR Supplier", warehouse_id=warehouse.id, receipt_date=day, currency="EUR", items=[PurchaseLineInput(product_id=product["id"], quantity=D("10"), unit_cost=D("6"))]), request, db, tenant)
    receipt = db.get(PurchaseReceipt, result["id"])
    assert receipt.exchange_rate_to_base == D("1.2"), f"Receipt ignored effective date: {receipt.exchange_rate_to_base}"
    bill = db.scalar(select(PayableBill).where(PayableBill.purchase_receipt_id == receipt.id))
    account = create_account(FinancialAccountCreate(name="QA EUR Cash", account_type="cash", currency="EUR", opening_balance=D("100")), request, db, tenant)
    def journal_lines(source_id):
        return db.execute(select(JournalLine, LedgerAccount.system_key).join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id).join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id).where(JournalEntry.source_id == source_id, JournalEntry.organization_id == org)).all()
    def check(source_id, expected):
        lines = journal_lines(source_id)
        assert sum(line.debit for line, _ in lines) == sum(line.credit for line, _ in lines)
        for key, signed in expected.items():
            assert sum((line.debit-line.credit for line,k in lines if k == key),D("0")) == D(signed), (key, lines)
        return lines
    check(receipt.id, {"inventory_asset":"72", "accounts_payable":"-72"})
    partial = pay_payable_bill(bill.id, PayablePaymentCreate(financial_account_id=account.id, payment_date=day+timedelta(days=1), amount=D("20")), request, db, tenant)
    check(partial.id, {"accounts_payable":"24", "realized_fx_loss":"4", f"financial_account:{account.id}":"-28"})
    assert receipt.balance_due == bill.balance_due == D("40")
    final = pay_payable_bill(bill.id, PayablePaymentCreate(financial_account_id=account.id, payment_date=day+timedelta(days=2), amount=D("40")), request, db, tenant)
    check(final.id, {"accounts_payable":"48", "realized_fx_gain":"-4", f"financial_account:{account.id}":"-44"})
    assert bill.balance_due == receipt.balance_due == 0
    assert db.scalar(select(func.sum(FinancialTransaction.amount)).where(FinancialTransaction.account_id == account.id)) == D("60")
    reverse_business_transaction(CorrectionRequest(source_type="payable_payment", source_id=final.id, reversal_date=day+timedelta(days=2), reason="Synthetic FX reversal"), request, db, tenant)
    assert receipt.balance_due == D("40")
    repaid = pay_payable_bill(bill.id, PayablePaymentCreate(financial_account_id=account.id, payment_date=day+timedelta(days=2), amount=D("40")), request, db, tenant)
    check(repaid.id, {"accounts_payable":"48", "realized_fx_gain":"-4", f"financial_account:{account.id}":"-44"})
    adjustment_result = adjustment(AdjustmentCreate(product_id=product["id"], warehouse_id=warehouse.id, adjustment_date=day, quantity_delta=D("1"), unit_cost=D("6"), reason="Synthetic historical FX adjustment"), request, db, tenant)
    check(adjustment_result["id"], {"inventory_asset":"7.20", "inventory_adjustment_gain":"-7.20"})
    balance = db.scalar(select(InventoryBalance).where(InventoryBalance.product_id == product["id"]))
    assert balance.inventory_value == D("66") and balance.inventory_value_base == D("79.20")
    negative = adjustment(AdjustmentCreate(product_id=product["id"], warehouse_id=warehouse.id, adjustment_date=day+timedelta(days=2), quantity_delta=D("-1"), reason="Synthetic carrying cost adjustment"), request, db, tenant)
    check(negative["id"], {"inventory_asset":"-7.20", "inventory_adjustment_expense":"7.20"})
    assert balance.inventory_value_base == D("72")
    assert total_ap() == ap_before, "Foreign receipt AP did not fully clear"
    transactions = db.scalars(select(FinancialTransaction).where(FinancialTransaction.account_id == account.id)).all()
    assert sum((t.amount if t.direction == "debit" else -t.amount for t in transactions), D("0")) == D("60")
    for key, expected in (("realized_fx_gain",D("-4")), ("realized_fx_loss",D("4"))):
        signed = db.scalar(select(func.sum(JournalLine.debit-JournalLine.credit)).join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id).where(LedgerAccount.organization_id == org, LedgerAccount.system_key == key))
        assert signed == expected, (key,signed)
    print("PASS FX: dated EUR receipt72USD; partial AP24/loss4; final AP48/gain4; reversal/re-payment; dated adjustment and carrying-cost reduction")


def main():
    assert engine.url.host in {"localhost", "127.0.0.1", "::1"}, "Local database only"
    with engine.connect() as conn:
        outer = conn.begin()
        db = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            marker = uuid4().hex[:10]
            user = User(email=f"inventory-qa-{marker}@example.test", full_name="Synthetic Inventory QA")
            db.add(user); db.flush()
            org = Organization(name="Synthetic Inventory QA", slug=f"inventory-qa-{marker}", currency="USD", timezone="UTC", created_by_user_id=user.id)
            db.add(org); db.flush()
            tenant = SimpleNamespace(organization_id=org.id, user_id=user.id, organization=org)
            request = Request({"type": "http", "method": "POST", "path": "/qa", "headers": [], "client": ("127.0.0.1", 1)})
            ensure_default_chart(db, org.id, user.id)
            ensure_initial_functional_currency_period(db, org, user.id)
            warehouse = create_warehouse(WarehouseCreate(code="QA-A", name="QA Warehouse A"), request, db, tenant)
            product = create_product(ProductCreate(sku="QA-STOCK-001", name="Synthetic Stock", item_type="stock_item", currency="USD", standard_cost=D("6")), request, db, tenant)
            today = date.today()
            receipt = receive_purchase(PurchaseReceiptCreate(supplier_name="Synthetic Supplier", warehouse_id=warehouse.id, receipt_date=today, currency="USD", items=[PurchaseLineInput(product_id=product["id"], quantity=D("10"), unit_cost=D("6"))]), request, db, tenant)
            bill = db.scalar(select(PayableBill).where(PayableBill.purchase_receipt_id == receipt["id"]))
            assert bill and bill.balance_due == D("60")
            def workspace(status="open"):
                return payables_workspace(db, tenant, status_filter=status, limit=50)
            assert workspace().outstanding_by_currency[0].amount == D("60")
            assert workspace().items[0].purchase_receipt_id == receipt["id"]
            assert db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id == org.id)) == 1, "Duplicate receipt journal"
            account = create_account(FinancialAccountCreate(name="QA Cash", account_type="cash", currency="USD", opening_balance=D("100")), request, db, tenant)
            def pay(amount):
                return pay_payable_bill(bill.id, PayablePaymentCreate(financial_account_id=account.id, payment_date=today, amount=D(amount)), request, db, tenant)
            pay("20")
            purchase = db.get(PurchaseReceipt, receipt["id"])
            assert purchase.amount_paid == D("20") and purchase.balance_due == D("40")
            assert workspace("partial").items[0].balance_due == D("40")
            try:
                pay("41")
                raise AssertionError("Overpayment accepted")
            except HTTPException as exc:
                assert exc.status_code == 400
            p2 = pay("40")
            assert purchase.balance_due == 0 and workspace().open_bill_count == 0
            ap = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == org.id, LedgerAccount.system_key == "accounts_payable"))
            def ap_balance():
                return db.scalar(select(func.sum(JournalLine.credit - JournalLine.debit)).where(JournalLine.organization_id == org.id, JournalLine.ledger_account_id == ap.id))
            assert ap_balance() == 0
            reverse_business_transaction(CorrectionRequest(source_type="payable_payment", source_id=p2.id, reason="Synthetic reversal QA", reversal_date=today), request, db, tenant)
            assert purchase.balance_due == D("40") and ap_balance() == D("40")
            pay("40")
            assert purchase.balance_due == 0 and ap_balance() == 0
            def adjust(delta):
                return adjustment(AdjustmentCreate(product_id=product["id"], warehouse_id=warehouse.id, adjustment_date=today, quantity_delta=D(delta), unit_cost=D("6"), reason="Synthetic adjustment", reference="QA2-STOCK-ADD-001"), request, db, tenant)
            # A custom account may already occupy the new preferred gain code.
            custom = LedgerAccount(organization_id=org.id, code="4920", name="Existing custom income", category="income", normal_balance="credit")
            db.add(custom); db.flush()
            plus = adjust("1")
            balance = db.scalar(select(InventoryBalance).where(InventoryBalance.product_id == product["id"]))
            assert balance.on_hand_quantity == D("11") and balance.inventory_value == D("66") and balance.inventory_value_base == D("66")
            minus = adjust("-1")
            assert balance.on_hand_quantity == D("10") and balance.inventory_value == D("60")
            try:
                adjust("-11")
                raise AssertionError("Stock overdraw accepted")
            except HTTPException as exc:
                assert exc.status_code == 409
            assert balance.on_hand_quantity == D("10")
            for result in (plus, minus):
                assert db.scalar(select(func.count()).select_from(StockMovement).where(StockMovement.source_id == result["id"])) == 1
                journal = db.scalar(select(JournalEntry).where(JournalEntry.source_id == result["id"]))
                lines = db.scalars(select(JournalLine).where(JournalLine.journal_entry_id == journal.id)).all()
                assert sum(x.debit for x in lines) == sum(x.credit for x in lines) == D("6")
            from app.api.v1.inventory import _ledger
            gain = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == org.id, LedgerAccount.system_key == "inventory_adjustment_gain"))
            fx = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == org.id, LedgerAccount.system_key == "realized_fx_gain"))
            assert gain.code == "4920-1" and fx.code == "4910" and custom.system_key is None
            assert _ledger(db, org.id, user.id, system_key="inventory_adjustment_gain", code="4920", name="Inventory Adjustment Gain", category="income", normal_balance="credit").id == gain.id
            # Legacy tenants can already have the gain at 4910: keep its identity/code.
            legacy = db.begin_nested()
            try:
                fx.code = "4911"; db.flush()
                gain.code = "4910"; db.flush()
                reused = _ledger(db, org.id, user.id, system_key="inventory_adjustment_gain", code="4920", name="Inventory Adjustment Gain", category="income", normal_balance="credit")
                assert reused.id == gain.id and reused.code == "4910"
            finally:
                legacy.rollback()
            # Tax reports already count receipts; the linked payable must not count them again.
            from app.models.tax import TaxCode
            from app.api.v1.tax import tax_report
            from app.api.v1.accounting_read_fast_extra import tax_report_fast
            tax = TaxCode(organization_id=org.id, code="QA10", name="QA purchase tax", tax_kind="purchase", rate=D("10"), recoverable_percent=D("100"), created_by_user_id=user.id)
            db.add(tax); db.flush()
            receive_purchase(PurchaseReceiptCreate(supplier_name="Tax QA Supplier", warehouse_id=warehouse.id, receipt_date=today, currency="USD", items=[PurchaseLineInput(product_id=product["id"], quantity=D("10"), unit_cost=D("6"), tax_code_id=tax.id)]), request, db, tenant)
            for report in (tax_report(db, tenant, today, today), tax_report_fast(db, tenant, today, today)):
                assert report["rows"][0]["input_tax"] == D("6"), report
                assert report["rows"][0]["recoverable_input_tax"] == D("6"), report
            from app.services.accounting_integrity_audit import audit_organization_accounting
            audit = audit_organization_accounting(db, org.id)
            assert not any(issue.code == "payable_missing_journal" for issue in audit.issues)
            verify_foreign_inventory(db, tenant, request, warehouse)
            print("PASS QA-002: receipt AP visible; partial/final/overpayment/reversal/re-payment reconcile; no duplicate journal")
            print("PASS QA-008: +1/-1 quantity, source/base value, history and balanced journals; overdraw rejected")
        finally:
            db.close()
            outer.rollback()


if __name__ == "__main__":
    main()
