from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.accounting_reconciliation import ReconciliationCreate, create_reconciliation, detail, finalize, select_transaction
from app.db.session import SessionLocal, engine
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.reconciliation import BankReconciliation, BankReconciliationItem


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
        account = FinancialAccount(organization_id=tenant.organization_id, name=f"CI Reconciliation {marker}", account_type="bank", currency="BDT", opening_balance=Decimal("1000"), is_active=True, created_by_user_id=tenant.user_id)
        db.add(account); db.flush()
        incoming = FinancialTransaction(organization_id=tenant.organization_id, account_id=account.id, transaction_date=date(2097,1,5), direction="credit", amount=Decimal("100"), currency="BDT", source_type="reconciliation_ci", source_id=str(uuid4()), reference=f"REC-IN-{marker}", description="Statement deposit", created_by_user_id=tenant.user_id)
        outgoing = FinancialTransaction(organization_id=tenant.organization_id, account_id=account.id, transaction_date=date(2097,1,7), direction="debit", amount=Decimal("20"), currency="BDT", source_type="reconciliation_ci", source_id=str(uuid4()), reference=f"REC-OUT-{marker}", description="Statement fee", created_by_user_id=tenant.user_id)
        db.add_all([incoming,outgoing]); db.commit()

        rec = create_reconciliation(ReconciliationCreate(account_id=account.id, statement_end_date=date(2097,1,31), statement_ending_balance=Decimal("1080")), request("POST","/accounting/reconciliations"), db, tenant)  # type: ignore[arg-type]
        if rec["difference"] != Decimal("80.00"): raise AssertionError(f"unexpected initial difference {rec['difference']}")
        select_transaction(rec["id"], incoming.id, request("POST","/match"), db, tenant)  # type: ignore[arg-type]
        mid = detail(rec["id"], db, tenant)  # type: ignore[arg-type]
        if mid["difference"] != Decimal("-20.00"): raise AssertionError(f"unexpected one-match difference {mid['difference']}")
        select_transaction(rec["id"], outgoing.id, request("POST","/match"), db, tenant)  # type: ignore[arg-type]
        done = finalize(rec["id"], request("POST","/finalize"), db, tenant)  # type: ignore[arg-type]
        if done["status"] != "finalized" or done["difference"] != Decimal("0.00") or done["cleared_book_balance"] != Decimal("1080.00"): raise AssertionError("final reconciliation totals failed")
        stored = db.scalar(select(BankReconciliation).where(BankReconciliation.id == rec["id"]))
        items = db.scalars(select(BankReconciliationItem).where(BankReconciliationItem.reconciliation_id == rec["id"])).all()
        if stored is None or stored.finalized_at is None or len(items) != 2: raise AssertionError("reconciliation persistence failed")
    finally:
        db.close()
    print("bank reconciliation verification passed: draft -> match -> zero difference -> finalize -> lock")


if __name__ == "__main__":
    main()
