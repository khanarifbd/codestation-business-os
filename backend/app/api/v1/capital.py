from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import LedgerAccount
from app.models.capital import (
    CompanyInvestment,
    CompanyInvestmentFunding,
    CompanyInvestor,
    CompanyInvestorFunding,
    CompanyInvestorPayout,
    CompanyLoan,
    InvestmentReturn,
    InvestorPayout,
    LoanRepayment,
    ProjectInvestor,
    ProjectInvestorFunding,
)
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.projects import Project
from app.services.accounting_posting import PostingLine, financial_ledger_account, post_journal, system_account, to_base_amount
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/capital", tags=["Investments & Funding"])
CapitalViewer = Annotated[TenantContext, Depends(require_tenant_permission("capital.view"))]
CapitalManager = Annotated[TenantContext, Depends(require_tenant_permission("capital.manage"))]
MONEY = Decimal("0.01")


def money(v) -> Decimal:
    return Decimal(v or 0).quantize(MONEY)


def account(db: DbSession, org: str, account_id: str, currency: str) -> FinancialAccount:
    row = db.scalar(select(FinancialAccount).where(FinancialAccount.id == account_id, FinancialAccount.organization_id == org, FinancialAccount.is_active.is_(True)))
    if row is None:
        raise HTTPException(404, "Financial account not found")
    if row.currency != currency:
        raise HTTPException(400, "Account currency must match transaction currency")
    return row


def balance(db: DbSession, acc: FinancialAccount, org: str) -> Decimal:
    net = db.scalar(select(func.coalesce(func.sum(case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)), 0)).where(FinancialTransaction.organization_id == org, FinancialTransaction.account_id == acc.id))
    return money(acc.opening_balance + Decimal(net or 0))


def cash_ledger(db: DbSession, tenant: TenantContext, *, account_id: str, tx_date: date, direction: str, amount: Decimal, currency: str, source_type: str, source_id: str, reference: str | None, description: str) -> None:
    if amount <= 0:
        return
    db.add(FinancialTransaction(organization_id=tenant.organization_id, account_id=account_id, transaction_date=tx_date, direction=direction, amount=money(amount), currency=currency, source_type=source_type, source_id=source_id, reference=reference, description=description, created_by_user_id=tenant.user_id))


def share_capital_account(db: DbSession, tenant: TenantContext) -> LedgerAccount:
    row = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == tenant.organization_id, LedgerAccount.system_key == "share_capital", LedgerAccount.is_active.is_(True)))
    if row:
        return row
    row = LedgerAccount(organization_id=tenant.organization_id, code="3200", name="Share Capital", category="equity", subtype="share_capital", normal_balance="credit", parent_id=None, system_key="share_capital", is_system=True, is_active=True, allow_manual_posting=False, notes="Company investor equity funding", created_by_user_id=tenant.user_id)
    db.add(row)
    db.flush()
    return row


def posting_line(db: DbSession, tenant: TenantContext, ledger_id: str, *, tx_date: date, debit: Decimal = Decimal("0"), credit: Decimal = Decimal("0"), currency: str, description: str) -> PostingLine:
    original = debit if debit > 0 else credit
    base, rate = to_base_amount(db, tenant.organization_id, tenant.organization.currency, original, currency, rate_date=tx_date)
    return PostingLine(ledger_account_id=ledger_id, debit=base if debit > 0 else Decimal("0"), credit=base if credit > 0 else Decimal("0"), description=description, currency=currency, exchange_rate_to_base=rate, original_amount=original)


def post_incoming(db: DbSession, tenant: TenantContext, *, account_id: str, amount: Decimal, currency: str, tx_date: date, source_type: str, source_id: str, reference: str | None, description: str, credit_account: LedgerAccount) -> None:
    _, cash = financial_ledger_account(db, tenant.organization_id, account_id)
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=tx_date, source_type=source_type, source_id=source_id, reference=reference, memo=description, lines=[
        posting_line(db, tenant, cash.id, tx_date=tx_date, debit=amount, currency=currency, description=description),
        posting_line(db, tenant, credit_account.id, tx_date=tx_date, credit=amount, currency=currency, description=description),
    ])


def post_outgoing_investment(db: DbSession, tenant: TenantContext, *, account_id: str, amount: Decimal, currency: str, tx_date: date, source_type: str, source_id: str, reference: str | None, description: str) -> None:
    _, cash = financial_ledger_account(db, tenant.organization_id, account_id)
    investment_asset = system_account(db, tenant.organization_id, "investments")
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=tx_date, source_type=source_type, source_id=source_id, reference=reference, memo=description, lines=[
        posting_line(db, tenant, investment_asset.id, tx_date=tx_date, debit=amount, currency=currency, description=description),
        posting_line(db, tenant, cash.id, tx_date=tx_date, credit=amount, currency=currency, description=description),
    ])


def post_investment_return(db: DbSession, tenant: TenantContext, *, account_id: str, currency: str, tx_date: date, source_id: str, reference: str | None, principal: Decimal, income: Decimal, description: str) -> None:
    _, cash = financial_ledger_account(db, tenant.organization_id, account_id)
    investment_asset = system_account(db, tenant.organization_id, "investments")
    income_account = system_account(db, tenant.organization_id, "other_income")
    total = money(principal + income)
    lines = [posting_line(db, tenant, cash.id, tx_date=tx_date, debit=total, currency=currency, description=description)]
    if principal > 0:
        lines.append(posting_line(db, tenant, investment_asset.id, tx_date=tx_date, credit=principal, currency=currency, description="Principal returned"))
    if income > 0:
        lines.append(posting_line(db, tenant, income_account.id, tx_date=tx_date, credit=income, currency=currency, description="Investment income"))
    # FX conversion rounding can differ by one cent when a receipt is split. Keep
    # the journal balanced by adjusting the final credit line in base currency.
    debit_total = money(sum((x.debit for x in lines), Decimal("0")))
    credit_total = money(sum((x.credit for x in lines), Decimal("0")))
    if debit_total != credit_total and len(lines) > 1:
        last = lines[-1]
        lines[-1] = PostingLine(ledger_account_id=last.ledger_account_id, debit=last.debit, credit=money(last.credit + (debit_total - credit_total)), description=last.description, currency=last.currency, exchange_rate_to_base=last.exchange_rate_to_base, original_amount=last.original_amount)
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=tx_date, source_type="investment_return", source_id=source_id, reference=reference, memo=description, lines=lines)


def post_investor_payout(db: DbSession, tenant: TenantContext, *, account_id: str, currency: str, tx_date: date, source_type: str, source_id: str, reference: str | None, principal: Decimal, profit: Decimal, principal_account: LedgerAccount, description: str) -> None:
    _, cash = financial_ledger_account(db, tenant.organization_id, account_id)
    profit_expense = system_account(db, tenant.organization_id, "investor_profit_share")
    total = money(principal + profit)
    lines = [posting_line(db, tenant, cash.id, tx_date=tx_date, credit=total, currency=currency, description=description)]
    if principal > 0:
        lines.append(posting_line(db, tenant, principal_account.id, tx_date=tx_date, debit=principal, currency=currency, description="Investor principal returned"))
    if profit > 0:
        lines.append(posting_line(db, tenant, profit_expense.id, tx_date=tx_date, debit=profit, currency=currency, description="Investor profit distribution"))
    credit_total = money(sum((x.credit for x in lines), Decimal("0")))
    debit_total = money(sum((x.debit for x in lines), Decimal("0")))
    if credit_total != debit_total and len(lines) > 1:
        last = lines[-1]
        lines[-1] = PostingLine(ledger_account_id=last.ledger_account_id, debit=money(last.debit + (credit_total - debit_total)), credit=last.credit, description=last.description, currency=last.currency, exchange_rate_to_base=last.exchange_rate_to_base, original_amount=last.original_amount)
    post_journal(db, organization_id=tenant.organization_id, user_id=tenant.user_id, entry_date=tx_date, source_type=source_type, source_id=source_id, reference=reference, memo=description, lines=lines)


class LoanCreate(BaseModel):
    lender_name: str = Field(min_length=2, max_length=220)
    lender_type: Literal["bank", "person", "investor", "company", "other"] = "other"
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
        if self.principal_amount + self.interest_amount <= 0:
            raise ValueError("Payment amount must be greater than zero")
        return self


class InvestmentCreate(BaseModel):
    investee_name: str = Field(min_length=2, max_length=220)
    investment_type: Literal["equity", "project", "deposit", "asset", "other"] = "other"
    currency: str = Field(min_length=3, max_length=3)
    invested_amount: Decimal = Field(gt=0)
    ownership_percent: Decimal | None = Field(default=None, ge=0, le=100)
    investment_date: date
    expected_exit_date: date | None = None
    account_id: str
    reference: str | None = None
    notes: str | None = None


class FundingCreate(BaseModel):
    account_id: str
    funding_date: date
    amount: Decimal = Field(gt=0)
    reference: str | None = None
    notes: str | None = None


class ReturnCreate(BaseModel):
    account_id: str
    return_date: date
    return_type: Literal["profit", "dividend", "interest", "sale", "other"] = "profit"
    cash_amount: Decimal = Field(gt=0)
    principal_return_amount: Decimal = Field(default=0, ge=0)
    income_amount: Decimal = Field(default=0, ge=0)
    reference: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def split(self):
        if money(self.principal_return_amount + self.income_amount) != money(self.cash_amount):
            raise ValueError("Principal return plus income must equal cash amount")
        return self


class CompanyInvestorCreate(BaseModel):
    investor_name: str = Field(min_length=2, max_length=220)
    investor_email: str | None = None
    investor_type: Literal["individual", "company", "fund", "other"] = "individual"
    instrument: Literal["equity", "profit_share", "revenue_share", "convertible", "other"] = "equity"
    currency: str = Field(min_length=3, max_length=3)
    committed_amount: Decimal = Field(gt=0)
    ownership_percent: Decimal | None = Field(default=None, ge=0, le=100)
    valuation_amount: Decimal | None = Field(default=None, gt=0)
    agreement_date: date
    effective_date: date | None = None
    expected_exit_date: date | None = None
    agreement_reference: str | None = None
    notes: str | None = None


class ProjectInvestorCreate(BaseModel):
    project_id: str
    investor_name: str = Field(min_length=2, max_length=220)
    investor_email: str | None = None
    currency: str = Field(min_length=3, max_length=3)
    committed_amount: Decimal = Field(gt=0)
    investment_date: date
    share_type: Literal["profit_percent", "revenue_share", "fixed_return", "convertible", "other"] = "profit_percent"
    share_value: Decimal = Field(ge=0)
    agreement_reference: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def percent(self):
        if self.share_type in {"profit_percent", "revenue_share"} and self.share_value > 100:
            raise ValueError("Share percent cannot exceed 100%")
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
        if self.principal_return_amount + self.profit_share_amount <= 0:
            raise ValueError("Payout amount must be greater than zero")
        return self


def loan_json(x: CompanyLoan):
    return {"id": x.id, "lender_name": x.lender_name, "lender_type": x.lender_type, "currency": x.currency, "principal_amount": x.principal_amount, "outstanding_principal": x.outstanding_principal, "annual_interest_rate": x.annual_interest_rate, "loan_date": x.loan_date, "maturity_date": x.maturity_date, "account_id": x.account_id, "status": x.status, "reference": x.reference, "notes": x.notes}


def inv_json(x: CompanyInvestment):
    return {"id": x.id, "investee_name": x.investee_name, "investment_type": x.investment_type, "currency": x.currency, "invested_amount": x.invested_amount, "carrying_value": x.carrying_value, "ownership_percent": x.ownership_percent, "investment_date": x.investment_date, "expected_exit_date": x.expected_exit_date, "account_id": x.account_id, "status": x.status, "reference": x.reference, "notes": x.notes}


def company_investor_json(x: CompanyInvestor):
    return {"id": x.id, "investor_name": x.investor_name, "investor_email": x.investor_email, "investor_type": x.investor_type, "instrument": x.instrument, "currency": x.currency, "committed_amount": x.committed_amount, "funded_amount": x.funded_amount, "outstanding_commitment": money(x.committed_amount - x.funded_amount), "ownership_percent": x.ownership_percent, "valuation_amount": x.valuation_amount, "agreement_date": x.agreement_date, "effective_date": x.effective_date, "expected_exit_date": x.expected_exit_date, "agreement_reference": x.agreement_reference, "status": x.status, "notes": x.notes}


def project_investor_json(x: ProjectInvestor, project_name: str | None = None):
    return {"id": x.id, "project_id": x.project_id, "project_name": project_name, "investor_name": x.investor_name, "investor_email": x.investor_email, "currency": x.currency, "committed_amount": x.committed_amount, "funded_amount": x.funded_amount, "invested_amount": x.invested_amount, "outstanding_commitment": money(x.committed_amount - x.funded_amount), "investment_date": x.investment_date, "share_type": x.share_type, "share_value": x.share_value, "status": x.status, "agreement_reference": x.agreement_reference, "notes": x.notes}


@router.get("/meta")
def meta(db: DbSession, tenant: CapitalViewer):
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == tenant.organization_id, FinancialAccount.is_active.is_(True)).order_by(FinancialAccount.currency, FinancialAccount.name)).all()
    projects = db.scalars(select(Project).where(Project.organization_id == tenant.organization_id, Project.status != "cancelled").order_by(Project.created_at.desc()).limit(200)).all()
    return {"accounts": [{"id": x.id, "name": x.name, "currency": x.currency, "account_type": x.account_type, "balance": balance(db, x, tenant.organization_id)} for x in accounts], "projects": [{"id": x.id, "project_number": x.project_number, "name": x.name, "currency": x.currency, "contract_value": x.contract_value, "status": x.status} for x in projects]}


@router.get("/dashboard")
def dashboard(db: DbSession, tenant: CapitalViewer):
    org = tenant.organization_id
    investments = db.scalars(select(CompanyInvestment).where(CompanyInvestment.organization_id == org)).all()
    company_investors = db.scalars(select(CompanyInvestor).where(CompanyInvestor.organization_id == org)).all()
    project_investors = db.scalars(select(ProjectInvestor).where(ProjectInvestor.organization_id == org)).all()
    returns = db.execute(select(CompanyInvestment.currency, func.sum(InvestmentReturn.income_amount)).join(CompanyInvestment, CompanyInvestment.id == InvestmentReturn.investment_id).where(InvestmentReturn.organization_id == org).group_by(CompanyInvestment.currency)).all()
    company_payouts = db.execute(select(CompanyInvestor.currency, func.sum(CompanyInvestorPayout.profit_share_amount)).join(CompanyInvestor, CompanyInvestor.id == CompanyInvestorPayout.investor_id).where(CompanyInvestorPayout.organization_id == org).group_by(CompanyInvestor.currency)).all()
    project_payouts = db.execute(select(ProjectInvestor.currency, func.sum(InvestorPayout.profit_share_amount)).join(ProjectInvestor, ProjectInvestor.id == InvestorPayout.investor_id).where(InvestorPayout.organization_id == org).group_by(ProjectInvestor.currency)).all()
    currencies = sorted({x.currency for x in investments + company_investors + project_investors} | {x[0] for x in returns + company_payouts + project_payouts})
    rows = []
    for c in currencies:
        rows.append({
            "currency": c,
            "company_committed": money(sum((x.committed_amount for x in company_investors if x.currency == c and x.status == "active"), Decimal("0"))),
            "company_funded": money(sum((x.funded_amount for x in company_investors if x.currency == c and x.status == "active"), Decimal("0"))),
            "project_committed": money(sum((x.committed_amount for x in project_investors if x.currency == c and x.status == "active"), Decimal("0"))),
            "project_funded": money(sum((x.funded_amount for x in project_investors if x.currency == c and x.status == "active"), Decimal("0"))),
            "our_investments": money(sum((x.carrying_value for x in investments if x.currency == c and x.status == "active"), Decimal("0"))),
            "investment_income": money(next((v for code, v in returns if code == c), 0)),
            "investor_profit_paid": money(next((v for code, v in company_payouts if code == c), 0)) + money(next((v for code, v in project_payouts if code == c), 0)),
        })
    return {"rows": rows, "active_company_investors": sum(1 for x in company_investors if x.status == "active"), "active_project_investors": sum(1 for x in project_investors if x.status == "active"), "active_investments": sum(1 for x in investments if x.status == "active")}


# Legacy loan routes remain for backward compatibility. New loan accounting lives
# under /accounting/loans and is intentionally not shown in the Investments UI.
@router.get("/loans")
def loans(db: DbSession, tenant: CapitalViewer):
    return [loan_json(x) for x in db.scalars(select(CompanyLoan).where(CompanyLoan.organization_id == tenant.organization_id).order_by(CompanyLoan.loan_date.desc(), CompanyLoan.created_at.desc())).all()]


@router.post("/loans", status_code=201)
def create_loan(payload: LoanCreate, request: Request, db: DbSession, tenant: CapitalManager):
    currency = payload.currency.upper()
    acc = account(db, tenant.organization_id, payload.account_id, currency) if payload.account_id else None
    row = CompanyLoan(organization_id=tenant.organization_id, lender_name=payload.lender_name.strip(), lender_type=payload.lender_type, currency=currency, principal_amount=money(payload.principal_amount), outstanding_principal=money(payload.principal_amount), annual_interest_rate=payload.annual_interest_rate, loan_date=payload.loan_date, maturity_date=payload.maturity_date, account_id=payload.account_id, status="active", reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    if acc:
        cash_ledger(db, tenant, account_id=acc.id, tx_date=row.loan_date, direction="credit", amount=row.principal_amount, currency=currency, source_type="company_loan", source_id=row.id, reference=row.reference, description=f"Loan received from {row.lender_name}")
    record_activity(db, action="capital.loan.create", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="company_loan", entity_id=row.id, after=loan_json(row), request=request)
    db.commit(); return loan_json(row)


@router.post("/loans/{loan_id}/repay", status_code=201)
def repay(loan_id: str, payload: RepaymentCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan_id, CompanyLoan.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Loan not found")
    principal, interest = money(payload.principal_amount), money(payload.interest_amount)
    if principal > row.outstanding_principal: raise HTTPException(400, "Principal repayment exceeds outstanding balance")
    acc = account(db, tenant.organization_id, payload.account_id, row.currency); total = money(principal + interest)
    if balance(db, acc, tenant.organization_id) < total: raise HTTPException(409, "Insufficient account balance")
    p = LoanRepayment(organization_id=tenant.organization_id, loan_id=row.id, account_id=acc.id, payment_date=payload.payment_date, principal_amount=principal, interest_amount=interest, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(p); db.flush(); row.outstanding_principal = money(row.outstanding_principal - principal); row.status = "paid" if row.outstanding_principal == 0 else "active"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=p.payment_date, direction="debit", amount=total, currency=row.currency, source_type="loan_repayment", source_id=p.id, reference=p.reference, description=f"Loan repayment to {row.lender_name}")
    record_activity(db, action="capital.loan.repay", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="loan_repayment", entity_id=p.id, after={"loan_id": row.id, "principal": principal, "interest": interest, "outstanding": row.outstanding_principal}, request=request)
    db.commit(); return {"id": p.id, "loan_id": row.id, "principal_amount": principal, "interest_amount": interest, "outstanding_principal": row.outstanding_principal, "status": row.status}


@router.get("/company-investors")
def company_investors(db: DbSession, tenant: CapitalViewer):
    return [company_investor_json(x) for x in db.scalars(select(CompanyInvestor).where(CompanyInvestor.organization_id == tenant.organization_id).order_by(CompanyInvestor.created_at.desc())).all()]


@router.post("/company-investors", status_code=201)
def create_company_investor(payload: CompanyInvestorCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = CompanyInvestor(organization_id=tenant.organization_id, investor_name=payload.investor_name.strip(), investor_email=payload.investor_email, investor_type=payload.investor_type, instrument=payload.instrument, currency=payload.currency.upper(), committed_amount=money(payload.committed_amount), funded_amount=money(0), ownership_percent=payload.ownership_percent, valuation_amount=money(payload.valuation_amount) if payload.valuation_amount else None, agreement_date=payload.agreement_date, effective_date=payload.effective_date, expected_exit_date=payload.expected_exit_date, agreement_reference=payload.agreement_reference, status="active", notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    record_activity(db, action="capital.company_investor.create", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="company_investor", entity_id=row.id, after=company_investor_json(row), request=request)
    db.commit(); return company_investor_json(row)


@router.post("/company-investors/{investor_id}/fundings", status_code=201)
def fund_company_investor(investor_id: str, payload: FundingCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(CompanyInvestor).where(CompanyInvestor.id == investor_id, CompanyInvestor.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Company investor not found")
    amount = money(payload.amount)
    if money(row.funded_amount + amount) > row.committed_amount: raise HTTPException(400, "Funding exceeds committed amount")
    acc = account(db, tenant.organization_id, payload.account_id, row.currency)
    funding = CompanyInvestorFunding(organization_id=tenant.organization_id, investor_id=row.id, account_id=acc.id, funding_date=payload.funding_date, amount=amount, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(funding); db.flush(); row.funded_amount = money(row.funded_amount + amount)
    description = f"Company funding from {row.investor_name}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=funding.funding_date, direction="credit", amount=amount, currency=row.currency, source_type="company_investor_funding", source_id=funding.id, reference=funding.reference, description=description)
    credit_account = share_capital_account(db, tenant) if row.instrument == "equity" else system_account(db, tenant.organization_id, "investor_funds_payable")
    post_incoming(db, tenant, account_id=acc.id, amount=amount, currency=row.currency, tx_date=funding.funding_date, source_type="company_investor_funding", source_id=funding.id, reference=funding.reference, description=description, credit_account=credit_account)
    record_activity(db, action="capital.company_investor.fund", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="company_investor_funding", entity_id=funding.id, after={"investor_id": row.id, "amount": amount, "funded_amount": row.funded_amount}, request=request)
    db.commit(); return {"id": funding.id, **company_investor_json(row)}


@router.post("/company-investors/{investor_id}/payouts", status_code=201)
def company_investor_payout(investor_id: str, payload: PayoutCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(CompanyInvestor).where(CompanyInvestor.id == investor_id, CompanyInvestor.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Company investor not found")
    principal, profit = money(payload.principal_return_amount), money(payload.profit_share_amount)
    paid_principal = money(db.scalar(select(func.coalesce(func.sum(CompanyInvestorPayout.principal_return_amount), 0)).where(CompanyInvestorPayout.organization_id == tenant.organization_id, CompanyInvestorPayout.investor_id == row.id)) or 0)
    if money(paid_principal + principal) > row.funded_amount: raise HTTPException(400, "Principal payout exceeds funded amount")
    acc = account(db, tenant.organization_id, payload.account_id, row.currency); total = money(principal + profit)
    if balance(db, acc, tenant.organization_id) < total: raise HTTPException(409, "Insufficient account balance")
    payout = CompanyInvestorPayout(organization_id=tenant.organization_id, investor_id=row.id, account_id=acc.id, payout_date=payload.payout_date, principal_return_amount=principal, profit_share_amount=profit, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(payout); db.flush()
    description = f"Company investor payout to {row.investor_name}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=payout.payout_date, direction="debit", amount=total, currency=row.currency, source_type="company_investor_payout", source_id=payout.id, reference=payout.reference, description=description)
    principal_account = share_capital_account(db, tenant) if row.instrument == "equity" else system_account(db, tenant.organization_id, "investor_funds_payable")
    post_investor_payout(db, tenant, account_id=acc.id, currency=row.currency, tx_date=payout.payout_date, source_type="company_investor_payout", source_id=payout.id, reference=payout.reference, principal=principal, profit=profit, principal_account=principal_account, description=description)
    if money(paid_principal + principal) == row.funded_amount and row.funded_amount == row.committed_amount: row.status = "settled"
    record_activity(db, action="capital.company_investor.payout", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="company_investor_payout", entity_id=payout.id, after={"investor_id": row.id, "principal": principal, "profit": profit, "status": row.status}, request=request)
    db.commit(); return {"id": payout.id, "status": row.status}


@router.get("/company-investors/{investor_id}/statement")
def company_investor_statement(investor_id: str, db: DbSession, tenant: CapitalViewer):
    row = db.scalar(select(CompanyInvestor).where(CompanyInvestor.id == investor_id, CompanyInvestor.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Company investor not found")
    fundings = db.scalars(select(CompanyInvestorFunding).where(CompanyInvestorFunding.organization_id == tenant.organization_id, CompanyInvestorFunding.investor_id == row.id).order_by(CompanyInvestorFunding.funding_date, CompanyInvestorFunding.created_at)).all()
    payouts = db.scalars(select(CompanyInvestorPayout).where(CompanyInvestorPayout.organization_id == tenant.organization_id, CompanyInvestorPayout.investor_id == row.id).order_by(CompanyInvestorPayout.payout_date, CompanyInvestorPayout.created_at)).all()
    principal_returned = money(sum((x.principal_return_amount for x in payouts), Decimal("0"))); profit_paid = money(sum((x.profit_share_amount for x in payouts), Decimal("0")))
    return {"investor": company_investor_json(row), "fundings": [{"id": x.id, "date": x.funding_date, "amount": x.amount, "account_id": x.account_id, "reference": x.reference} for x in fundings], "payouts": [{"id": x.id, "date": x.payout_date, "principal_return_amount": x.principal_return_amount, "profit_share_amount": x.profit_share_amount, "account_id": x.account_id, "reference": x.reference} for x in payouts], "principal_returned": principal_returned, "profit_paid": profit_paid, "outstanding_capital": money(row.funded_amount - principal_returned)}


@router.get("/investments")
def investments(db: DbSession, tenant: CapitalViewer):
    return [inv_json(x) for x in db.scalars(select(CompanyInvestment).where(CompanyInvestment.organization_id == tenant.organization_id).order_by(CompanyInvestment.investment_date.desc())).all()]


@router.post("/investments", status_code=201)
def create_investment(payload: InvestmentCreate, request: Request, db: DbSession, tenant: CapitalManager):
    currency = payload.currency.upper(); amount = money(payload.invested_amount); acc = account(db, tenant.organization_id, payload.account_id, currency)
    if balance(db, acc, tenant.organization_id) < amount: raise HTTPException(409, "Insufficient account balance")
    row = CompanyInvestment(organization_id=tenant.organization_id, investee_name=payload.investee_name.strip(), investment_type=payload.investment_type, currency=currency, invested_amount=amount, carrying_value=amount, ownership_percent=payload.ownership_percent, investment_date=payload.investment_date, expected_exit_date=payload.expected_exit_date, account_id=acc.id, status="active", reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    funding = CompanyInvestmentFunding(organization_id=tenant.organization_id, investment_id=row.id, account_id=acc.id, funding_date=row.investment_date, amount=amount, reference=row.reference, notes="Initial investment funding", created_by_user_id=tenant.user_id)
    db.add(funding); db.flush()
    description = f"Investment in {row.investee_name}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=row.investment_date, direction="debit", amount=amount, currency=currency, source_type="company_investment_funding", source_id=funding.id, reference=row.reference, description=description)
    post_outgoing_investment(db, tenant, account_id=acc.id, amount=amount, currency=currency, tx_date=row.investment_date, source_type="company_investment_funding", source_id=funding.id, reference=row.reference, description=description)
    record_activity(db, action="capital.investment.create", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="company_investment", entity_id=row.id, after=inv_json(row), request=request)
    db.commit(); return inv_json(row)


@router.post("/investments/{investment_id}/fundings", status_code=201)
def add_investment_funding(investment_id: str, payload: FundingCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(CompanyInvestment).where(CompanyInvestment.id == investment_id, CompanyInvestment.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Investment not found")
    amount = money(payload.amount); acc = account(db, tenant.organization_id, payload.account_id, row.currency)
    if balance(db, acc, tenant.organization_id) < amount: raise HTTPException(409, "Insufficient account balance")
    funding = CompanyInvestmentFunding(organization_id=tenant.organization_id, investment_id=row.id, account_id=acc.id, funding_date=payload.funding_date, amount=amount, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(funding); db.flush(); row.invested_amount = money(row.invested_amount + amount); row.carrying_value = money(row.carrying_value + amount)
    description = f"Additional investment in {row.investee_name}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=funding.funding_date, direction="debit", amount=amount, currency=row.currency, source_type="company_investment_funding", source_id=funding.id, reference=funding.reference, description=description)
    post_outgoing_investment(db, tenant, account_id=acc.id, amount=amount, currency=row.currency, tx_date=funding.funding_date, source_type="company_investment_funding", source_id=funding.id, reference=funding.reference, description=description)
    record_activity(db, action="capital.investment.fund", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="company_investment_funding", entity_id=funding.id, after={"investment_id": row.id, "amount": amount, "invested_amount": row.invested_amount, "carrying_value": row.carrying_value}, request=request)
    db.commit(); return {"id": funding.id, **inv_json(row)}


@router.post("/investments/{investment_id}/returns", status_code=201)
def add_return(investment_id: str, payload: ReturnCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(CompanyInvestment).where(CompanyInvestment.id == investment_id, CompanyInvestment.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Investment not found")
    acc = account(db, tenant.organization_id, payload.account_id, row.currency); principal = money(payload.principal_return_amount); income = money(payload.income_amount)
    if principal > row.carrying_value: raise HTTPException(400, "Principal return exceeds carrying value")
    r = InvestmentReturn(organization_id=tenant.organization_id, investment_id=row.id, account_id=acc.id, return_date=payload.return_date, return_type=payload.return_type, cash_amount=money(payload.cash_amount), principal_return_amount=principal, income_amount=income, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(r); db.flush(); row.carrying_value = money(row.carrying_value - principal); row.status = "exited" if row.carrying_value == 0 else row.status
    description = f"Investment return from {row.investee_name}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=r.return_date, direction="credit", amount=r.cash_amount, currency=row.currency, source_type="investment_return", source_id=r.id, reference=r.reference, description=description)
    post_investment_return(db, tenant, account_id=acc.id, currency=row.currency, tx_date=r.return_date, source_id=r.id, reference=r.reference, principal=principal, income=income, description=description)
    record_activity(db, action="capital.investment.return", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="investment_return", entity_id=r.id, after={"investment_id": row.id, "cash": r.cash_amount, "principal": principal, "income": income, "carrying_value": row.carrying_value}, request=request)
    db.commit(); return {"id": r.id, "cash_amount": r.cash_amount, "income_amount": r.income_amount, "carrying_value": row.carrying_value, "status": row.status}


@router.get("/investments/{investment_id}/statement")
def investment_statement(investment_id: str, db: DbSession, tenant: CapitalViewer):
    row = db.scalar(select(CompanyInvestment).where(CompanyInvestment.id == investment_id, CompanyInvestment.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Investment not found")
    fundings = db.scalars(select(CompanyInvestmentFunding).where(CompanyInvestmentFunding.organization_id == tenant.organization_id, CompanyInvestmentFunding.investment_id == row.id).order_by(CompanyInvestmentFunding.funding_date, CompanyInvestmentFunding.created_at)).all()
    returns = db.scalars(select(InvestmentReturn).where(InvestmentReturn.organization_id == tenant.organization_id, InvestmentReturn.investment_id == row.id).order_by(InvestmentReturn.return_date, InvestmentReturn.created_at)).all()
    return {"investment": inv_json(row), "fundings": [{"id": x.id, "date": x.funding_date, "amount": x.amount, "reference": x.reference} for x in fundings], "returns": [{"id": x.id, "date": x.return_date, "type": x.return_type, "cash_amount": x.cash_amount, "principal_return_amount": x.principal_return_amount, "income_amount": x.income_amount, "reference": x.reference} for x in returns]}


@router.get("/project-investors")
def project_investors(db: DbSession, tenant: CapitalViewer):
    rows = db.execute(select(ProjectInvestor, Project.name).join(Project, Project.id == ProjectInvestor.project_id).where(ProjectInvestor.organization_id == tenant.organization_id).order_by(ProjectInvestor.investment_date.desc())).all()
    return [project_investor_json(x, n) for x, n in rows]


@router.post("/project-investors", status_code=201)
def create_project_investor(payload: ProjectInvestorCreate, request: Request, db: DbSession, tenant: CapitalManager):
    project = db.scalar(select(Project).where(Project.id == payload.project_id, Project.organization_id == tenant.organization_id))
    if project is None: raise HTTPException(404, "Project not found")
    currency = payload.currency.upper()
    if currency != project.currency: raise HTTPException(400, "Investor currency must match project currency")
    row = ProjectInvestor(organization_id=tenant.organization_id, project_id=project.id, investor_name=payload.investor_name.strip(), investor_email=payload.investor_email, currency=currency, invested_amount=money(0), committed_amount=money(payload.committed_amount), funded_amount=money(0), investment_date=payload.investment_date, share_type=payload.share_type, share_value=payload.share_value, account_id=None, status="active", agreement_reference=payload.agreement_reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(row); db.flush()
    record_activity(db, action="capital.project_investor.create", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="project_investor", entity_id=row.id, after=project_investor_json(row, project.name), request=request)
    db.commit(); return project_investor_json(row, project.name)


@router.post("/project-investors/{investor_id}/fundings", status_code=201)
def fund_project_investor(investor_id: str, payload: FundingCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(ProjectInvestor).where(ProjectInvestor.id == investor_id, ProjectInvestor.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Project investor not found")
    amount = money(payload.amount)
    if money(row.funded_amount + amount) > row.committed_amount: raise HTTPException(400, "Funding exceeds committed amount")
    acc = account(db, tenant.organization_id, payload.account_id, row.currency)
    funding = ProjectInvestorFunding(organization_id=tenant.organization_id, investor_id=row.id, account_id=acc.id, funding_date=payload.funding_date, amount=amount, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(funding); db.flush(); row.funded_amount = money(row.funded_amount + amount); row.invested_amount = row.funded_amount; row.account_id = acc.id
    project = db.scalar(select(Project).where(Project.id == row.project_id, Project.organization_id == tenant.organization_id))
    description = f"Project funding from {row.investor_name} for {project.name if project else row.project_id}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=funding.funding_date, direction="credit", amount=amount, currency=row.currency, source_type="project_investor_funding", source_id=funding.id, reference=funding.reference, description=description)
    post_incoming(db, tenant, account_id=acc.id, amount=amount, currency=row.currency, tx_date=funding.funding_date, source_type="project_investor_funding", source_id=funding.id, reference=funding.reference, description=description, credit_account=system_account(db, tenant.organization_id, "investor_funds_payable"))
    record_activity(db, action="capital.project_investor.fund", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="project_investor_funding", entity_id=funding.id, after={"investor_id": row.id, "amount": amount, "funded_amount": row.funded_amount}, request=request)
    db.commit(); return {"id": funding.id, **project_investor_json(row, project.name if project else None)}

@router.post("/project-investors/{investor_id}/payouts", status_code=201)
def payout(investor_id: str, payload: PayoutCreate, request: Request, db: DbSession, tenant: CapitalManager):
    row = db.scalar(select(ProjectInvestor).where(ProjectInvestor.id == investor_id, ProjectInvestor.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Project investor not found")
    principal, profit = money(payload.principal_return_amount), money(payload.profit_share_amount)
    acc = account(db, tenant.organization_id, payload.account_id, row.currency); total = money(principal + profit)
    if balance(db, acc, tenant.organization_id) < total: raise HTTPException(409, "Insufficient account balance")
    paid_principal = money(db.scalar(select(func.coalesce(func.sum(InvestorPayout.principal_return_amount), 0)).where(InvestorPayout.organization_id == tenant.organization_id, InvestorPayout.investor_id == row.id)) or 0)
    if money(paid_principal + principal) > row.funded_amount: raise HTTPException(400, "Principal payout exceeds funded amount")
    p = InvestorPayout(organization_id=tenant.organization_id, investor_id=row.id, account_id=acc.id, payout_date=payload.payout_date, principal_return_amount=principal, profit_share_amount=profit, reference=payload.reference, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(p); db.flush(); description = f"Project investor payout to {row.investor_name}"
    cash_ledger(db, tenant, account_id=acc.id, tx_date=p.payout_date, direction="debit", amount=total, currency=row.currency, source_type="investor_payout", source_id=p.id, reference=p.reference, description=description)
    post_investor_payout(db, tenant, account_id=acc.id, currency=row.currency, tx_date=p.payout_date, source_type="investor_payout", source_id=p.id, reference=p.reference, principal=principal, profit=profit, principal_account=system_account(db, tenant.organization_id, "investor_funds_payable"), description=description)
    if money(paid_principal + principal) == row.funded_amount and row.funded_amount == row.committed_amount: row.status = "settled"
    record_activity(db, action="capital.project_investor.payout", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="investor_payout", entity_id=p.id, after={"investor_id": row.id, "principal": principal, "profit_share": profit, "status": row.status}, request=request)
    db.commit(); return {"id": p.id, "investor_id": row.id, "principal_return_amount": principal, "profit_share_amount": profit, "status": row.status}


@router.get("/project-investors/{investor_id}/statement")
def project_investor_statement(investor_id: str, db: DbSession, tenant: CapitalViewer):
    row = db.scalar(select(ProjectInvestor).where(ProjectInvestor.id == investor_id, ProjectInvestor.organization_id == tenant.organization_id))
    if row is None: raise HTTPException(404, "Project investor not found")
    project = db.scalar(select(Project).where(Project.id == row.project_id, Project.organization_id == tenant.organization_id))
    fundings = db.scalars(select(ProjectInvestorFunding).where(ProjectInvestorFunding.organization_id == tenant.organization_id, ProjectInvestorFunding.investor_id == row.id).order_by(ProjectInvestorFunding.funding_date, ProjectInvestorFunding.created_at)).all()
    payouts = db.scalars(select(InvestorPayout).where(InvestorPayout.organization_id == tenant.organization_id, InvestorPayout.investor_id == row.id).order_by(InvestorPayout.payout_date, InvestorPayout.created_at)).all()
    principal_returned = money(sum((x.principal_return_amount for x in payouts), Decimal("0"))); profit_paid = money(sum((x.profit_share_amount for x in payouts), Decimal("0")))
    return {"investor": project_investor_json(row, project.name if project else None), "fundings": [{"id": x.id, "date": x.funding_date, "amount": x.amount, "account_id": x.account_id, "reference": x.reference} for x in fundings], "payouts": [{"id": x.id, "date": x.payout_date, "principal_return_amount": x.principal_return_amount, "profit_share_amount": x.profit_share_amount, "account_id": x.account_id, "reference": x.reference} for x in payouts], "principal_returned": principal_returned, "profit_paid": profit_paid, "outstanding_capital": money(row.funded_amount - principal_returned)}
