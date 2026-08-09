from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.capital import CompanyInvestment, CompanyLoan, InvestmentReturn, InvestorPayout, LoanRepayment, ProjectInvestor
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.projects import Project
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/capital", tags=["Capital & Funding"])
CapitalViewer = Annotated[TenantContext, Depends(require_tenant_permission("capital.view"))]
CapitalManager = Annotated[TenantContext, Depends(require_tenant_permission("capital.manage"))]
MONEY = Decimal("0.01")


def money(v) -> Decimal:
    return Decimal(v or 0).quantize(MONEY)


def account(db: DbSession, org: str, account_id: str, currency: str) -> FinancialAccount:
    row = db.scalar(select(FinancialAccount).where(FinancialAccount.id == account_id, FinancialAccount.organization_id == org, FinancialAccount.is_active.is_(True)))
    if row is None: raise HTTPException(404, "Financial account not found")
    if row.currency != currency: raise HTTPException(400, "Account currency must match transaction currency")
    return row


def balance(db: DbSession, acc: FinancialAccount, org: str) -> Decimal:
    net = db.scalar(select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(FinancialTransaction.organization_id == org, FinancialTransaction.account_id == acc.id))
    return money(acc.opening_balance + Decimal(net or 0))


def ledger(db: DbSession, tenant: TenantContext, *, account_id: str, tx_date: date, direction: str, amount: Decimal, currency: str, source_type: str, source_id: str, reference: str | None, description: str):
    if amount <= 0: return
    db.add(FinancialTransaction(organization_id=tenant.organization_id, account_id=account_id, transaction_date=tx_date, direction=direction, amount=money(amount), currency=currency, source_type=source_type, source_id=source_id, reference=reference, description=description, created_by_user_id=tenant.user_id))


class LoanCreate(BaseModel):
    lender_name: str = Field(min_length=2, max_length=220)
    lender_type: Literal["bank","person","investor","company","other"] = "other"
    currency: str = Field(min_length=3, max_length=3)
    principal_amount: Decimal = Field(gt=0)
    annual_interest_rate: Decimal = Field(default=0, ge=0)
    loan_date: date
    maturity_date: date | None = None
    account_id: str | None = None
    reference: str | None = None
    notes: str | None = None

class RepaymentCreate(BaseModel):
    account_id: str
    payment_date: date
    principal_amount: Decimal = Field(default=0, ge=0)
    interest_amount: Decimal = Field(default=0, ge=0)
    reference: str | None = None
    notes: str | None = None
    @model_validator(mode="after")
    def nonzero(self):
        if self.principal_amount + self.interest_amount <= 0: raise ValueError("Payment amount must be greater than zero")
        return self

class InvestmentCreate(BaseModel):
    investee_name: str = Field(min_length=2, max_length=220)
    investment_type: Literal["equity","project","deposit","asset","other"] = "other"
    currency: str = Field(min_length=3, max_length=3)
    invested_amount: Decimal = Field(gt=0)
    ownership_percent: Decimal | None = Field(default=None, ge=0, le=100)
    investment_date: date
    expected_exit_date: date | None = None
    account_id: str | None = None
    reference: str | None = None
    notes: str | None = None

class ReturnCreate(BaseModel):
    account_id: str
    return_date: date
    return_type: Literal["profit","dividend","interest","sale","other"] = "profit"
    cash_amount: Decimal = Field(gt=0)
    principal_return_amount: Decimal = Field(default=0, ge=0)
    income_amount: Decimal = Field(default=0, ge=0)
    reference: str | None = None
    notes: str | None = None
    @model_validator(mode="after")
    def split(self):
        if money(self.principal_return_amount + self.income_amount) != money(self.cash_amount): raise ValueError("Principal return plus income must equal cash amount")
        return self

class InvestorCreate(BaseModel):
    project_id: str
    investor_name: str = Field(min_length=2, max_length=220)
    investor_email: str | None = None
    currency: str = Field(min_length=3, max_length=3)
    invested_amount: Decimal = Field(gt=0)
    investment_date: date
    share_type: Literal["profit_percent","fixed_return"] = "profit_percent"
    share_value: Decimal = Field(ge=0)
    account_id: str | None = None
    agreement_reference: str | None = None
    notes: str | None = None
    @model_validator(mode="after")
    def percent(self):
        if self.share_type == "profit_percent" and self.share_value > 100: raise ValueError("Profit share cannot exceed 100%")
        return self

class PayoutCreate(BaseModel):
    account_id: str
    payout_date: date
    principal_return_amount: Decimal = Field(default=0, ge=0)
    profit_share_amount: Decimal = Field(default=0, ge=0)
    reference: str | None = None
    notes: str | None = None
    @model_validator(mode="after")
    def nonzero(self):
        if self.principal_return_amount + self.profit_share_amount <= 0: raise ValueError("Payout amount must be greater than zero")
        return self


def loan_json(x: CompanyLoan): return {"id":x.id,"lender_name":x.lender_name,"lender_type":x.lender_type,"currency":x.currency,"principal_amount":x.principal_amount,"outstanding_principal":x.outstanding_principal,"annual_interest_rate":x.annual_interest_rate,"loan_date":x.loan_date,"maturity_date":x.maturity_date,"account_id":x.account_id,"status":x.status,"reference":x.reference,"notes":x.notes}
def inv_json(x: CompanyInvestment): return {"id":x.id,"investee_name":x.investee_name,"investment_type":x.investment_type,"currency":x.currency,"invested_amount":x.invested_amount,"carrying_value":x.carrying_value,"ownership_percent":x.ownership_percent,"investment_date":x.investment_date,"expected_exit_date":x.expected_exit_date,"account_id":x.account_id,"status":x.status,"reference":x.reference,"notes":x.notes}
def investor_json(x: ProjectInvestor, project_name: str | None=None): return {"id":x.id,"project_id":x.project_id,"project_name":project_name,"investor_name":x.investor_name,"investor_email":x.investor_email,"currency":x.currency,"invested_amount":x.invested_amount,"investment_date":x.investment_date,"share_type":x.share_type,"share_value":x.share_value,"account_id":x.account_id,"status":x.status,"agreement_reference":x.agreement_reference,"notes":x.notes}

@router.get("/meta")
def meta(db: DbSession, tenant: CapitalViewer):
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id==tenant.organization_id, FinancialAccount.is_active.is_(True)).order_by(FinancialAccount.currency, FinancialAccount.name)).all()
    projects = db.scalars(select(Project).where(Project.organization_id==tenant.organization_id, Project.status != "cancelled").order_by(Project.created_at.desc()).limit(200)).all()
    return {"accounts":[{"id":x.id,"name":x.name,"currency":x.currency,"account_type":x.account_type,"balance":balance(db,x,tenant.organization_id)} for x in accounts], "projects":[{"id":x.id,"project_number":x.project_number,"name":x.name,"currency":x.currency,"contract_value":x.contract_value,"status":x.status} for x in projects]}

@router.get("/dashboard")
def dashboard(db: DbSession, tenant: CapitalViewer):
    org=tenant.organization_id
    loans=db.scalars(select(CompanyLoan).where(CompanyLoan.organization_id==org)).all(); investments=db.scalars(select(CompanyInvestment).where(CompanyInvestment.organization_id==org)).all(); investors=db.scalars(select(ProjectInvestor).where(ProjectInvestor.organization_id==org)).all()
    loan_interest=db.execute(select(LoanRepayment.currency if False else CompanyLoan.currency, func.sum(LoanRepayment.interest_amount)).join(CompanyLoan, CompanyLoan.id==LoanRepayment.loan_id).where(LoanRepayment.organization_id==org).group_by(CompanyLoan.currency)).all()
    returns=db.execute(select(CompanyInvestment.currency, func.sum(InvestmentReturn.income_amount)).join(CompanyInvestment, CompanyInvestment.id==InvestmentReturn.investment_id).where(InvestmentReturn.organization_id==org).group_by(CompanyInvestment.currency)).all()
    payouts=db.execute(select(ProjectInvestor.currency, func.sum(InvestorPayout.profit_share_amount)).join(ProjectInvestor, ProjectInvestor.id==InvestorPayout.investor_id).where(InvestorPayout.organization_id==org).group_by(ProjectInvestor.currency)).all()
    currencies=sorted({x.currency for x in loans+investments+investors} | {x[0] for x in loan_interest+returns+payouts})
    rows=[]
    for c in currencies:
        rows.append({"currency":c,"borrowed":money(sum((x.principal_amount for x in loans if x.currency==c),Decimal(0))),"loan_outstanding":money(sum((x.outstanding_principal for x in loans if x.currency==c),Decimal(0))),"invested":money(sum((x.carrying_value for x in investments if x.currency==c and x.status=="active"),Decimal(0))),"project_investor_funds":money(sum((x.invested_amount for x in investors if x.currency==c and x.status=="active"),Decimal(0))),"interest_paid":money(next((v for code,v in loan_interest if code==c),0)),"investment_income":money(next((v for code,v in returns if code==c),0)),"investor_profit_paid":money(next((v for code,v in payouts if code==c),0))})
    return {"rows":rows,"active_loans":sum(1 for x in loans if x.status=="active"),"active_investments":sum(1 for x in investments if x.status=="active"),"active_project_investors":sum(1 for x in investors if x.status=="active")}

@router.get("/loans")
def loans(db: DbSession, tenant: CapitalViewer): return [loan_json(x) for x in db.scalars(select(CompanyLoan).where(CompanyLoan.organization_id==tenant.organization_id).order_by(CompanyLoan.loan_date.desc(),CompanyLoan.created_at.desc())).all()]

@router.post("/loans", status_code=201)
def create_loan(payload: LoanCreate, request: Request, db: DbSession, tenant: CapitalManager):
    currency=payload.currency.upper(); acc=None
    if payload.account_id: acc=account(db,tenant.organization_id,payload.account_id,currency)
    row=CompanyLoan(organization_id=tenant.organization_id,lender_name=payload.lender_name.strip(),lender_type=payload.lender_type,currency=currency,principal_amount=money(payload.principal_amount),outstanding_principal=money(payload.principal_amount),annual_interest_rate=payload.annual_interest_rate,loan_date=payload.loan_date,maturity_date=payload.maturity_date,account_id=payload.account_id,status="active",reference=payload.reference,notes=payload.notes,created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    if acc: ledger(db,tenant,account_id=acc.id,tx_date=row.loan_date,direction="credit",amount=row.principal_amount,currency=currency,source_type="company_loan",source_id=row.id,reference=row.reference,description=f"Loan received from {row.lender_name}")
    record_activity(db,action="capital.loan.create",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="company_loan",entity_id=row.id,after=loan_json(row),request=request); db.commit(); return loan_json(row)

@router.post("/loans/{loan_id}/repay", status_code=201)
def repay(loan_id:str,payload:RepaymentCreate,request:Request,db:DbSession,tenant:CapitalManager):
    row=db.scalar(select(CompanyLoan).where(CompanyLoan.id==loan_id,CompanyLoan.organization_id==tenant.organization_id));
    if row is None: raise HTTPException(404,"Loan not found")
    principal=money(payload.principal_amount); interest=money(payload.interest_amount)
    if principal>row.outstanding_principal: raise HTTPException(400,"Principal repayment exceeds outstanding balance")
    acc=account(db,tenant.organization_id,payload.account_id,row.currency); total=money(principal+interest)
    if balance(db,acc,tenant.organization_id)<total: raise HTTPException(409,"Insufficient account balance")
    p=LoanRepayment(organization_id=tenant.organization_id,loan_id=row.id,account_id=acc.id,payment_date=payload.payment_date,principal_amount=principal,interest_amount=interest,reference=payload.reference,notes=payload.notes,created_by_user_id=tenant.user_id); db.add(p); db.flush(); row.outstanding_principal=money(row.outstanding_principal-principal); row.status="paid" if row.outstanding_principal==0 else "active"
    ledger(db,tenant,account_id=acc.id,tx_date=p.payment_date,direction="debit",amount=total,currency=row.currency,source_type="loan_repayment",source_id=p.id,reference=p.reference,description=f"Loan repayment to {row.lender_name}")
    record_activity(db,action="capital.loan.repay",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="loan_repayment",entity_id=p.id,after={"loan_id":row.id,"principal":principal,"interest":interest,"outstanding":row.outstanding_principal},request=request); db.commit(); return {"id":p.id,"loan_id":row.id,"principal_amount":principal,"interest_amount":interest,"outstanding_principal":row.outstanding_principal,"status":row.status}

@router.get("/investments")
def investments(db:DbSession,tenant:CapitalViewer): return [inv_json(x) for x in db.scalars(select(CompanyInvestment).where(CompanyInvestment.organization_id==tenant.organization_id).order_by(CompanyInvestment.investment_date.desc())).all()]

@router.post("/investments",status_code=201)
def create_investment(payload:InvestmentCreate,request:Request,db:DbSession,tenant:CapitalManager):
    currency=payload.currency.upper(); acc=None
    if payload.account_id:
        acc=account(db,tenant.organization_id,payload.account_id,currency)
        if balance(db,acc,tenant.organization_id)<money(payload.invested_amount): raise HTTPException(409,"Insufficient account balance")
    row=CompanyInvestment(organization_id=tenant.organization_id,investee_name=payload.investee_name.strip(),investment_type=payload.investment_type,currency=currency,invested_amount=money(payload.invested_amount),carrying_value=money(payload.invested_amount),ownership_percent=payload.ownership_percent,investment_date=payload.investment_date,expected_exit_date=payload.expected_exit_date,account_id=payload.account_id,status="active",reference=payload.reference,notes=payload.notes,created_by_user_id=tenant.user_id); db.add(row); db.flush()
    if acc: ledger(db,tenant,account_id=acc.id,tx_date=row.investment_date,direction="debit",amount=row.invested_amount,currency=currency,source_type="company_investment",source_id=row.id,reference=row.reference,description=f"Investment in {row.investee_name}")
    record_activity(db,action="capital.investment.create",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="company_investment",entity_id=row.id,after=inv_json(row),request=request); db.commit(); return inv_json(row)

@router.post("/investments/{investment_id}/returns",status_code=201)
def add_return(investment_id:str,payload:ReturnCreate,request:Request,db:DbSession,tenant:CapitalManager):
    row=db.scalar(select(CompanyInvestment).where(CompanyInvestment.id==investment_id,CompanyInvestment.organization_id==tenant.organization_id));
    if row is None: raise HTTPException(404,"Investment not found")
    acc=account(db,tenant.organization_id,payload.account_id,row.currency); principal=money(payload.principal_return_amount)
    if principal>row.carrying_value: raise HTTPException(400,"Principal return exceeds carrying value")
    r=InvestmentReturn(organization_id=tenant.organization_id,investment_id=row.id,account_id=acc.id,return_date=payload.return_date,return_type=payload.return_type,cash_amount=money(payload.cash_amount),principal_return_amount=principal,income_amount=money(payload.income_amount),reference=payload.reference,notes=payload.notes,created_by_user_id=tenant.user_id); db.add(r); db.flush(); row.carrying_value=money(row.carrying_value-principal); row.status="exited" if row.carrying_value==0 else row.status
    ledger(db,tenant,account_id=acc.id,tx_date=r.return_date,direction="credit",amount=r.cash_amount,currency=row.currency,source_type="investment_return",source_id=r.id,reference=r.reference,description=f"Investment return from {row.investee_name}")
    record_activity(db,action="capital.investment.return",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="investment_return",entity_id=r.id,after={"investment_id":row.id,"cash":r.cash_amount,"principal":principal,"income":r.income_amount,"carrying_value":row.carrying_value},request=request); db.commit(); return {"id":r.id,"cash_amount":r.cash_amount,"income_amount":r.income_amount,"carrying_value":row.carrying_value,"status":row.status}

@router.get("/project-investors")
def project_investors(db:DbSession,tenant:CapitalViewer):
    rows=db.execute(select(ProjectInvestor,Project.name).join(Project,Project.id==ProjectInvestor.project_id).where(ProjectInvestor.organization_id==tenant.organization_id).order_by(ProjectInvestor.investment_date.desc())).all(); return [investor_json(x,n) for x,n in rows]

@router.post("/project-investors",status_code=201)
def create_project_investor(payload:InvestorCreate,request:Request,db:DbSession,tenant:CapitalManager):
    project=db.scalar(select(Project).where(Project.id==payload.project_id,Project.organization_id==tenant.organization_id));
    if project is None: raise HTTPException(404,"Project not found")
    currency=payload.currency.upper();
    if currency!=project.currency: raise HTTPException(400,"Investor currency must match project currency in V1")
    acc=None
    if payload.account_id: acc=account(db,tenant.organization_id,payload.account_id,currency)
    row=ProjectInvestor(organization_id=tenant.organization_id,project_id=project.id,investor_name=payload.investor_name.strip(),investor_email=payload.investor_email,currency=currency,invested_amount=money(payload.invested_amount),investment_date=payload.investment_date,share_type=payload.share_type,share_value=payload.share_value,account_id=payload.account_id,status="active",agreement_reference=payload.agreement_reference,notes=payload.notes,created_by_user_id=tenant.user_id); db.add(row); db.flush()
    if acc: ledger(db,tenant,account_id=acc.id,tx_date=row.investment_date,direction="credit",amount=row.invested_amount,currency=currency,source_type="project_investor_funding",source_id=row.id,reference=row.agreement_reference,description=f"Project funding from {row.investor_name} for {project.name}")
    record_activity(db,action="capital.project_investor.create",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="project_investor",entity_id=row.id,after=investor_json(row,project.name),request=request); db.commit(); return investor_json(row,project.name)

@router.post("/project-investors/{investor_id}/payouts",status_code=201)
def payout(investor_id:str,payload:PayoutCreate,request:Request,db:DbSession,tenant:CapitalManager):
    row=db.scalar(select(ProjectInvestor).where(ProjectInvestor.id==investor_id,ProjectInvestor.organization_id==tenant.organization_id));
    if row is None: raise HTTPException(404,"Project investor not found")
    acc=account(db,tenant.organization_id,payload.account_id,row.currency); total=money(payload.principal_return_amount+payload.profit_share_amount)
    if balance(db,acc,tenant.organization_id)<total: raise HTTPException(409,"Insufficient account balance")
    paid_principal=money(db.scalar(select(func.coalesce(func.sum(InvestorPayout.principal_return_amount),0)).where(InvestorPayout.organization_id==tenant.organization_id,InvestorPayout.investor_id==row.id)) or 0)
    if money(paid_principal+payload.principal_return_amount)>row.invested_amount: raise HTTPException(400,"Principal payout exceeds invested amount")
    p=InvestorPayout(organization_id=tenant.organization_id,investor_id=row.id,account_id=acc.id,payout_date=payload.payout_date,principal_return_amount=money(payload.principal_return_amount),profit_share_amount=money(payload.profit_share_amount),reference=payload.reference,notes=payload.notes,created_by_user_id=tenant.user_id); db.add(p); db.flush()
    ledger(db,tenant,account_id=acc.id,tx_date=p.payout_date,direction="debit",amount=total,currency=row.currency,source_type="investor_payout",source_id=p.id,reference=p.reference,description=f"Investor payout to {row.investor_name}")
    if money(paid_principal+p.principal_return_amount)==row.invested_amount: row.status="settled"
    record_activity(db,action="capital.project_investor.payout",scope="tenant",actor_user_id=tenant.user_id,organization_id=tenant.organization_id,entity_type="investor_payout",entity_id=p.id,after={"investor_id":row.id,"principal":p.principal_return_amount,"profit_share":p.profit_share_amount,"status":row.status},request=request); db.commit(); return {"id":p.id,"investor_id":row.id,"principal_return_amount":p.principal_return_amount,"profit_share_amount":p.profit_share_amount,"status":row.status}
