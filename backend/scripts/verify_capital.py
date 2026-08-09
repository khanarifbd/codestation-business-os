from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.capital import (
    InvestmentCreate, InvestorCreate, LoanCreate, PayoutCreate, RepaymentCreate, ReturnCreate,
    add_return, create_investment, create_loan, create_project_investor, dashboard, payout, repay,
)
from app.db.session import SessionLocal, engine
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.projects import Project


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str

@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str
    organization: Org

def request(method:str,path:str)->Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})

def main()->None:
    with engine.begin() as conn:
        row=conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.timezone,o.currency,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant=Tenant(str(row["organization_id"]),str(row["user_id"]),str(row["membership_id"]),"admin",Org(str(row["organization_id"]),str(row["timezone"] or "UTC"),str(row["currency"] or "BDT")))
    db=SessionLocal(); marker=uuid4().hex[:8]
    try:
        acc=db.scalar(select(FinancialAccount).where(FinancialAccount.organization_id==tenant.organization_id,FinancialAccount.is_active.is_(True)).order_by(FinancialAccount.created_at.asc()))
        project=db.scalar(select(Project).where(Project.organization_id==tenant.organization_id).order_by(Project.created_at.asc()))
        if acc is None or project is None: raise AssertionError("capital fixture requires an account and project")
        currency=acc.currency
        loan=create_loan(LoanCreate(lender_name=f"CI Bank {marker}",lender_type="bank",currency=currency,principal_amount=Decimal("100000"),annual_interest_rate=Decimal("10"),loan_date=date(2096,1,1),account_id=acc.id,reference=f"LN-{marker}"),request("POST","/capital/loans"),db,tenant)  # type: ignore[arg-type]
        paid=repay(loan["id"],RepaymentCreate(account_id=acc.id,payment_date=date(2096,2,1),principal_amount=Decimal("10000"),interest_amount=Decimal("1000"),reference=f"LR-{marker}"),request("POST",f"/capital/loans/{loan['id']}/repay"),db,tenant)  # type: ignore[arg-type]
        if paid["outstanding_principal"]!=Decimal("90000.00"): raise AssertionError("loan outstanding calculation failed")
        inv=create_investment(InvestmentCreate(investee_name=f"CI Venture {marker}",investment_type="equity",currency=currency,invested_amount=Decimal("20000"),investment_date=date(2096,3,1),account_id=acc.id,reference=f"INV-{marker}"),request("POST","/capital/investments"),db,tenant)  # type: ignore[arg-type]
        ret=add_return(inv["id"],ReturnCreate(account_id=acc.id,return_date=date(2096,4,1),return_type="profit",cash_amount=Decimal("7000"),principal_return_amount=Decimal("5000"),income_amount=Decimal("2000"),reference=f"RET-{marker}"),request("POST",f"/capital/investments/{inv['id']}/returns"),db,tenant)  # type: ignore[arg-type]
        if ret["carrying_value"]!=Decimal("15000.00"): raise AssertionError("investment carrying value failed")
        if project.currency != currency:
            project.currency=currency; db.commit()
        pi=create_project_investor(InvestorCreate(project_id=project.id,investor_name=f"CI Investor {marker}",currency=currency,invested_amount=Decimal("30000"),investment_date=date(2096,5,1),share_type="profit_percent",share_value=Decimal("25"),account_id=acc.id,agreement_reference=f"PI-{marker}"),request("POST","/capital/project-investors"),db,tenant)  # type: ignore[arg-type]
        po=payout(pi["id"],PayoutCreate(account_id=acc.id,payout_date=date(2096,6,1),principal_return_amount=Decimal("5000"),profit_share_amount=Decimal("2000"),reference=f"PO-{marker}"),request("POST",f"/capital/project-investors/{pi['id']}/payouts"),db,tenant)  # type: ignore[arg-type]
        if po["profit_share_amount"]!=Decimal("2000.00"): raise AssertionError("investor payout failed")
        sources={x for x in db.scalars(select(FinancialTransaction.source_type).where(FinancialTransaction.organization_id==tenant.organization_id,FinancialTransaction.reference.in_([f"LN-{marker}",f"LR-{marker}",f"INV-{marker}",f"RET-{marker}",f"PI-{marker}",f"PO-{marker}"]))).all()}
        expected={"company_loan","loan_repayment","company_investment","investment_return","project_investor_funding","investor_payout"}
        if not expected.issubset(sources): raise AssertionError(f"capital ledger sources missing: {expected-sources}")
        d=dashboard(db,tenant)  # type: ignore[arg-type]
        row=next((x for x in d["rows"] if x["currency"]==currency),None)
        if row is None or row["interest_paid"]<Decimal("1000") or row["investment_income"]<Decimal("2000") or row["investor_profit_paid"]<Decimal("2000"): raise AssertionError("capital dashboard aggregation failed")
    finally: db.close()
    print("capital verification passed: loan -> repayment -> investment -> return -> project investor -> payout -> ledger -> dashboard")

if __name__=="__main__": main()
