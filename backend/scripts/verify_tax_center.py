from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.payables import create_payable_bill
from app.api.v1.tax import TaxCodeCreate, create_code, tax_report
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.payables import PayableBill
from app.schemas.payables import PayableBillCreate
from app.services.accounting_posting import system_account


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str = "admin"


def request(method: str, path: str) -> Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant = Tenant(str(row["organization_id"]), str(row["user_id"]), str(row["membership_id"]))
    db = SessionLocal(); marker = uuid4().hex[:8]
    try:
        expense = system_account(db, tenant.organization_id, "operating_expenses")
        purchase = create_code(TaxCodeCreate(code=f"PT{marker}", name="CI Purchase VAT", tax_kind="purchase", rate=Decimal("15"), recoverable_percent=Decimal("80"), country_code="BD", effective_from=date(2099,1,1)), request("POST","/accounting/tax/codes"), db, tenant)  # type: ignore[arg-type]
        withholding = create_code(TaxCodeCreate(code=f"WT{marker}", name="CI Withholding", tax_kind="withholding", rate=Decimal("10"), country_code="BD", effective_from=date(2099,1,1)), request("POST","/accounting/tax/codes"), db, tenant)  # type: ignore[arg-type]
        bill = create_payable_bill(PayableBillCreate(supplier_name="CI Tax Supplier", bill_date=date(2099,2,1), due_date=date(2099,2,28), currency="BDT", amount=Decimal("1000"), tax_code_id=purchase["id"], withholding_tax_code_id=withholding["id"], expense_ledger_account_id=expense.id, description="Tax center verification"), request("POST","/accounting/payables"), db, tenant)  # type: ignore[arg-type]
        if bill.input_tax_amount != Decimal("150.00") or bill.recoverable_tax_amount != Decimal("120.00"): raise AssertionError("input tax calculation failed")
        if bill.withholding_tax_amount != Decimal("100.00") or bill.original_amount != Decimal("1150.00") or bill.net_payable_amount != Decimal("1050.00") or bill.balance_due != Decimal("1050.00"): raise AssertionError("withholding/net payable calculation failed")
        stored = db.scalar(select(PayableBill).where(PayableBill.id == bill.id))
        journal = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == tenant.organization_id, JournalEntry.source_type == "payable_bill", JournalEntry.source_id == bill.id, JournalEntry.status == "posted"))
        if stored is None or journal is None: raise AssertionError("taxable payable persistence failed")
        lines = db.execute(select(JournalLine, LedgerAccount.system_key).join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id).where(JournalLine.journal_entry_id == journal.id)).all()
        debit = sum((Decimal(line.debit) for line, _ in lines), Decimal("0")); credit = sum((Decimal(line.credit) for line, _ in lines), Decimal("0"))
        keys = {key for _, key in lines}
        if debit != Decimal("1150.00") or credit != Decimal("1150.00") or "input_tax_receivable" not in keys or "withholding_tax_payable" not in keys: raise AssertionError("tax journal posting failed")
        report = tax_report(db, tenant, date(2099,1,1), date(2099,12,31))  # type: ignore[arg-type]
        bdt = next((item for item in report["rows"] if item["currency"] == "BDT"), None)
        if bdt is None or bdt["input_tax"] < Decimal("150.00") or bdt["recoverable_input_tax"] < Decimal("120.00") or bdt["withholding_tax"] < Decimal("100.00"): raise AssertionError("tax report failed")
    finally:
        db.close()
    print("tax center verification passed: tax codes -> input tax -> recoverability -> withholding -> net payable -> balanced journal -> report")


if __name__ == "__main__":
    main()
