from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.capital import (
    CompanyInvestorCreate,
    FundingCreate,
    InvestmentCreate,
    LoanCreate,
    PayoutCreate,
    ProjectInvestorCreate,
    RepaymentCreate,
    ReturnCreate,
    add_investment_funding,
    add_return,
    company_investor_payout,
    company_investor_statement,
    create_company_investor,
    create_investment,
    create_loan,
    create_project_investor,
    dashboard,
    fund_company_investor,
    fund_project_investor,
    payout,
    project_investor_statement,
    repay,
)
from app.api.v1.capital_insights import insights
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry
from app.models.company_defaults import OrganizationExchangeRate
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


def request(method: str, path: str) -> Request:
    return Request({"type": "http", "method": method, "path": path, "raw_path": path.encode(), "headers": [], "query_string": b"", "scheme": "https", "server": ("testserver", 443), "client": ("127.0.0.1", 50000)})


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.timezone,o.currency,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant = Tenant(str(row["organization_id"]), str(row["user_id"]), str(row["membership_id"]), "admin", Org(str(row["organization_id"]), str(row["timezone"] or "UTC"), str(row["currency"] or "BDT")))
    db = SessionLocal(); marker = uuid4().hex[:8]
    try:
        project = db.scalar(select(Project).where(Project.organization_id == tenant.organization_id).order_by(Project.created_at.asc()))
        if project is None: raise AssertionError("capital fixture requires a project")
        acc = db.scalar(select(FinancialAccount).where(FinancialAccount.organization_id == tenant.organization_id, FinancialAccount.is_active.is_(True), FinancialAccount.currency == project.currency).order_by(FinancialAccount.created_at.asc()))
        if acc is None: raise AssertionError(f"capital fixture requires an active {project.currency} account")
        currency = project.currency

        # The fixture project is intentionally foreign-currency. Real accounting must
        # reject journal posting without a configured FX pair, so seed a deterministic
        # test rate rather than weakening the production validation.
        if currency != tenant.organization.currency:
            fx = db.scalar(select(OrganizationExchangeRate).where(OrganizationExchangeRate.organization_id == tenant.organization_id, OrganizationExchangeRate.base_currency == currency, OrganizationExchangeRate.quote_currency == tenant.organization.currency))
            if fx is None:
                db.add(OrganizationExchangeRate(organization_id=tenant.organization_id, base_currency=currency, quote_currency=tenant.organization.currency, reference_rate=Decimal("110"), manual_rate=Decimal("110"), effective_rate=Decimal("110"), source="capital_ci_fixture"))
                db.flush()

        # Legacy debt routes remain compatible while loans are managed from Accounting.
        loan = create_loan(LoanCreate(lender_name=f"CI Bank {marker}", lender_type="bank", currency=currency, principal_amount=Decimal("100000"), annual_interest_rate=Decimal("10"), loan_date=date(2096, 1, 1), account_id=acc.id, reference=f"LN-{marker}"), request("POST", "/capital/loans"), db, tenant)  # type: ignore[arg-type]
        paid = repay(loan["id"], RepaymentCreate(account_id=acc.id, payment_date=date(2096, 2, 1), principal_amount=Decimal("10000"), interest_amount=Decimal("1000"), reference=f"LR-{marker}"), request("POST", f"/capital/loans/{loan['id']}/repay"), db, tenant)  # type: ignore[arg-type]
        if paid["outstanding_principal"] != Decimal("90000.00"): raise AssertionError("loan outstanding calculation failed")

        # Company invests externally. Initial and additional funding must reduce cash,
        # increase the investment asset and preserve carrying value history.
        inv = create_investment(InvestmentCreate(investee_name=f"CI Venture {marker}", investment_type="equity", currency=currency, invested_amount=Decimal("20000"), investment_date=date(2096, 3, 1), account_id=acc.id, reference=f"INV-{marker}"), request("POST", "/capital/investments"), db, tenant)  # type: ignore[arg-type]
        extra = add_investment_funding(inv["id"], FundingCreate(account_id=acc.id, funding_date=date(2096, 3, 15), amount=Decimal("5000"), reference=f"INV2-{marker}"), request("POST", f"/capital/investments/{inv['id']}/fundings"), db, tenant)  # type: ignore[arg-type]
        if extra["carrying_value"] != Decimal("25000.00"): raise AssertionError("additional investment funding failed")
        ret = add_return(inv["id"], ReturnCreate(account_id=acc.id, return_date=date(2096, 4, 1), return_type="profit", cash_amount=Decimal("7000"), principal_return_amount=Decimal("5000"), income_amount=Decimal("2000"), reference=f"RET-{marker}"), request("POST", f"/capital/investments/{inv['id']}/returns"), db, tenant)  # type: ignore[arg-type]
        if ret["carrying_value"] != Decimal("20000.00"): raise AssertionError("investment carrying value failed")

        # Company-level investor: commitment itself must not move cash. Funding does.
        ci = create_company_investor(CompanyInvestorCreate(investor_name=f"CI Company Investor {marker}", investor_type="individual", instrument="equity", currency=currency, committed_amount=Decimal("40000"), ownership_percent=Decimal("10"), agreement_date=date(2096, 5, 1), agreement_reference=f"CI-{marker}"), request("POST", "/capital/company-investors"), db, tenant)  # type: ignore[arg-type]
        if ci["funded_amount"] != Decimal("0.00"): raise AssertionError("company investor commitment moved cash")
        cif = fund_company_investor(ci["id"], FundingCreate(account_id=acc.id, funding_date=date(2096, 5, 5), amount=Decimal("15000"), reference=f"CIF-{marker}"), request("POST", f"/capital/company-investors/{ci['id']}/fundings"), db, tenant)  # type: ignore[arg-type]
        if cif["funded_amount"] != Decimal("15000.00") or cif["outstanding_commitment"] != Decimal("25000.00"): raise AssertionError("company investor funding totals failed")
        company_investor_payout(ci["id"], PayoutCreate(account_id=acc.id, payout_date=date(2096, 5, 20), principal_return_amount=Decimal("1000"), profit_share_amount=Decimal("500"), reference=f"CIP-{marker}"), request("POST", f"/capital/company-investors/{ci['id']}/payouts"), db, tenant)  # type: ignore[arg-type]
        cistatement = company_investor_statement(ci["id"], db, tenant)  # type: ignore[arg-type]
        if cistatement["outstanding_capital"] != Decimal("14000.00") or cistatement["profit_paid"] != Decimal("500.00"): raise AssertionError("company investor statement failed")

        # Project investor: agreement and actual funding are separate lifecycle events.
        pi = create_project_investor(ProjectInvestorCreate(project_id=project.id, investor_name=f"CI Project Investor {marker}", currency=currency, committed_amount=Decimal("30000"), investment_date=date(2096, 6, 1), share_type="profit_percent", share_value=Decimal("25"), agreement_reference=f"PI-{marker}"), request("POST", "/capital/project-investors"), db, tenant)  # type: ignore[arg-type]
        if pi["funded_amount"] != Decimal("0.00"): raise AssertionError("project commitment moved cash")
        pif = fund_project_investor(pi["id"], FundingCreate(account_id=acc.id, funding_date=date(2096, 6, 5), amount=Decimal("12000"), reference=f"PIF-{marker}"), request("POST", f"/capital/project-investors/{pi['id']}/fundings"), db, tenant)  # type: ignore[arg-type]
        if pif["funded_amount"] != Decimal("12000.00") or pif["outstanding_commitment"] != Decimal("18000.00"): raise AssertionError("project funding totals failed")
        po = payout(pi["id"], PayoutCreate(account_id=acc.id, payout_date=date(2096, 7, 1), principal_return_amount=Decimal("2000"), profit_share_amount=Decimal("1000"), reference=f"PO-{marker}"), request("POST", f"/capital/project-investors/{pi['id']}/payouts"), db, tenant)  # type: ignore[arg-type]
        if po["profit_share_amount"] != Decimal("1000.00"): raise AssertionError("project investor payout failed")
        pistatement = project_investor_statement(pi["id"], db, tenant)  # type: ignore[arg-type]
        if pistatement["outstanding_capital"] != Decimal("10000.00"): raise AssertionError("project investor statement failed")

        refs = [f"INV-{marker}", f"INV2-{marker}", f"RET-{marker}", f"CIF-{marker}", f"CIP-{marker}", f"PIF-{marker}", f"PO-{marker}"]
        sources = set(db.scalars(select(FinancialTransaction.source_type).where(FinancialTransaction.organization_id == tenant.organization_id, FinancialTransaction.reference.in_(refs))).all())
        expected = {"company_investment_funding", "investment_return", "company_investor_funding", "company_investor_payout", "project_investor_funding", "investor_payout"}
        if not expected.issubset(sources): raise AssertionError(f"capital cash ledger sources missing: {expected - sources}")
        journal_sources = set(db.scalars(select(JournalEntry.source_type).where(JournalEntry.organization_id == tenant.organization_id, JournalEntry.reference.in_(refs), JournalEntry.status == "posted")).all())
        if not expected.issubset(journal_sources): raise AssertionError(f"double-entry journal sources missing: {expected - journal_sources}")

        d = dashboard(db, tenant)  # type: ignore[arg-type]
        summary = next((x for x in d["rows"] if x["currency"] == currency), None)
        if summary is None or summary["company_funded"] < Decimal("15000") or summary["project_funded"] < Decimal("12000") or summary["investment_income"] < Decimal("2000"): raise AssertionError("investments dashboard aggregation failed")

        insight = insights(db, tenant, date_from=date(2096, 1, 1), date_to=date(2096, 12, 31))  # type: ignore[arg-type]
        settlement = next((x for x in insight["project_settlements"] if x["project_id"] == project.id), None)
        if settlement is None or not any(x["investor_id"] == pi["id"] for x in settlement["investors"]): raise AssertionError("project investor settlement preview failed")
    finally:
        db.close()
    print("capital verification passed: commitments -> installment funding -> investments -> returns -> payouts -> cash ledger -> double-entry journals -> statements")


if __name__ == "__main__":
    main()
