from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.api.v1.capital import (
    CompanyInvestorCreate,
    FundingCreate,
    InvestmentCreate,
    LoanCreate,
    OwnerEquityCreate,
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
    create_owner_equity_transaction,
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
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.company_defaults import OrganizationExchangeRate
from app.models.loan_accounting import LoanDisbursement
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.projects import Project
from app.services.exchange_rates import record_rate_snapshot


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
            for effective_date, rate in (
                (date(2096, 1, 1), Decimal("100")),
                (date(2096, 2, 1), Decimal("100")),
                (date(2096, 3, 1), Decimal("100")),
                (date(2096, 4, 1), Decimal("120")),
                (date(2096, 5, 1), Decimal("100")),
                (date(2096, 5, 20), Decimal("120")),
                (date(2096, 6, 1), Decimal("100")),
                (date(2096, 7, 1), Decimal("120")),
            ):
                record_rate_snapshot(
                    db,
                    organization_id=tenant.organization_id,
                    base_currency=currency,
                    quote_currency=tenant.organization.currency,
                    effective_date=effective_date,
                    effective_rate=rate,
                    reference_rate=rate,
                    source="capital_ci_fixture",
                    user_id=tenant.user_id,
                )

        base_account = db.scalar(
            select(FinancialAccount).where(
                FinancialAccount.organization_id == tenant.organization_id,
                FinancialAccount.is_active.is_(True),
                FinancialAccount.currency == tenant.organization.currency,
                FinancialAccount.account_type != "credit_card",
            ).order_by(FinancialAccount.created_at.asc())
        )
        if base_account is None:
            base_account = FinancialAccount(
                organization_id=tenant.organization_id,
                name=f"Capital Base CI {marker}",
                account_type="bank",
                currency=tenant.organization.currency,
                opening_balance=Decimal("100000"),
                is_active=True,
                created_by_user_id=tenant.user_id,
            )
            db.add(base_account)
            db.flush()

        # Legacy debt endpoints are compatibility wrappers over the canonical Accounting
        # loan workflow. They must never bypass Journal/Ledger posting.
        loan = create_loan(LoanCreate(lender_name=f"CI Bank {marker}", lender_type="bank", currency=currency, principal_amount=Decimal("100000"), annual_interest_rate=Decimal("10"), loan_date=date(2096, 1, 1), account_id=acc.id, reference=f"LN-{marker}"), request("POST", "/capital/loans"), db, tenant)  # type: ignore[arg-type]
        paid = repay(loan["id"], RepaymentCreate(account_id=acc.id, payment_date=date(2096, 2, 1), principal_amount=Decimal("10000"), interest_amount=Decimal("1000"), reference=f"LR-{marker}"), request("POST", f"/capital/loans/{loan['id']}/repay"), db, tenant)  # type: ignore[arg-type]
        if paid["outstanding_principal"] != Decimal("90000.00"): raise AssertionError("loan outstanding calculation failed")

        legacy_disbursement = db.scalar(
            select(LoanDisbursement).where(
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.loan_id == loan["id"],
                LoanDisbursement.principal_amount > 0,
            )
        )
        if legacy_disbursement is None:
            raise AssertionError("legacy loan compatibility create bypassed canonical disbursement tracking")
        disbursement_journal = db.scalar(
            select(JournalEntry.id).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.source_type == "loan_disbursement",
                JournalEntry.source_id == legacy_disbursement.id,
                JournalEntry.status == "posted",
            )
        )
        repayment_journal = db.scalar(
            select(JournalEntry.id).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.source_type == "loan_repayment_accounting",
                JournalEntry.source_id == paid["id"],
                JournalEntry.status == "posted",
            )
        )
        if disbursement_journal is None or repayment_journal is None:
            raise AssertionError("legacy loan compatibility routes must post canonical accounting journals")
        legacy_bypass_sources = set(
            db.scalars(
                select(FinancialTransaction.source_type).where(
                    FinancialTransaction.organization_id == tenant.organization_id,
                    FinancialTransaction.reference.in_([f"LN-{marker}", f"LR-{marker}"]),
                    FinancialTransaction.source_type.in_(["company_loan", "loan_repayment"]),
                )
            ).all()
        )
        if legacy_bypass_sources:
            raise AssertionError(f"legacy loan compatibility route bypass detected: {sorted(legacy_bypass_sources)}")

        # Company invests externally. Initial and additional funding must reduce cash,
        # increase the investment asset and preserve carrying value history.
        inv = create_investment(InvestmentCreate(investee_name=f"CI Venture {marker}", investment_type="equity", currency=currency, invested_amount=Decimal("20000"), investment_date=date(2096, 3, 1), account_id=acc.id, reference=f"INV-{marker}"), request("POST", "/capital/investments"), db, tenant)  # type: ignore[arg-type]
        extra = add_investment_funding(inv["id"], FundingCreate(account_id=acc.id, funding_date=date(2096, 3, 15), amount=Decimal("5000"), reference=f"INV2-{marker}"), request("POST", f"/capital/investments/{inv['id']}/fundings"), db, tenant)  # type: ignore[arg-type]
        if extra["carrying_value"] != Decimal("25000.00"): raise AssertionError("additional investment funding failed")
        ret = add_return(inv["id"], ReturnCreate(account_id=acc.id, return_date=date(2096, 4, 1), return_type="profit", cash_amount=Decimal("7000"), principal_return_amount=Decimal("5000"), income_amount=Decimal("2000"), reference=f"RET-{marker}"), request("POST", f"/capital/investments/{inv['id']}/returns"), db, tenant)  # type: ignore[arg-type]
        if ret["carrying_value"] != Decimal("20000.00"): raise AssertionError("investment carrying value failed")

        return_journal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "investment_return",
            JournalEntry.source_id == ret["id"],
            JournalEntry.status == "posted",
        ))
        if return_journal is None: raise AssertionError("investment return journal missing")
        return_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == return_journal.id)
        ).all()
        return_by_key = {key: line for line, key in return_lines}
        historical_rate = Decimal("100") if currency != tenant.organization.currency else Decimal("1")
        settlement_rate = Decimal("120") if currency != tenant.organization.currency else Decimal("1")
        if Decimal(return_by_key["investments"].credit) != Decimal("5000") * historical_rate:
            raise AssertionError("investment principal return did not clear historical carrying value")
        expected_investment_fx = Decimal("5000") * (settlement_rate - historical_rate)
        if expected_investment_fx > 0 and Decimal(return_by_key["realized_fx_gain"].credit) != expected_investment_fx:
            raise AssertionError("investment principal return realized FX gain is incorrect")

        # Company-level investor: commitment itself must not move cash. Funding does.
        ci = create_company_investor(CompanyInvestorCreate(investor_name=f"CI Company Investor {marker}", investor_type="individual", instrument="profit_share", currency=currency, committed_amount=Decimal("40000"), ownership_percent=Decimal("10"), agreement_date=date(2096, 5, 1), agreement_reference=f"CI-{marker}"), request("POST", "/capital/company-investors"), db, tenant)  # type: ignore[arg-type]
        if ci["funded_amount"] != Decimal("0.00"): raise AssertionError("company investor commitment moved cash")
        cif = fund_company_investor(ci["id"], FundingCreate(account_id=acc.id, funding_date=date(2096, 5, 5), amount=Decimal("15000"), reference=f"CIF-{marker}"), request("POST", f"/capital/company-investors/{ci['id']}/fundings"), db, tenant)  # type: ignore[arg-type]
        if cif["funded_amount"] != Decimal("15000.00") or cif["outstanding_commitment"] != Decimal("25000.00"): raise AssertionError("company investor funding totals failed")
        company_payout = company_investor_payout(ci["id"], PayoutCreate(account_id=acc.id, payout_date=date(2096, 5, 20), principal_return_amount=Decimal("1000"), profit_share_amount=Decimal("500"), reference=f"CIP-{marker}"), request("POST", f"/capital/company-investors/{ci['id']}/payouts"), db, tenant)  # type: ignore[arg-type]
        company_payout_journal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "company_investor_payout",
            JournalEntry.source_id == company_payout["id"],
            JournalEntry.status == "posted",
        ))
        if company_payout_journal is None: raise AssertionError("company investor payout journal missing")
        company_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == company_payout_journal.id)
        ).all()
        company_by_key = {key: line for line, key in company_lines}
        if Decimal(company_by_key["investor_funds_payable"].debit) != Decimal("1000") * historical_rate:
            raise AssertionError("company investor principal payout did not clear historical carrying value")
        if Decimal(company_by_key["investor_profit_share"].debit) != Decimal("500") * settlement_rate:
            raise AssertionError("non-equity investor profit share expense is incorrect")
        expected_company_fx = Decimal("1000") * (settlement_rate - historical_rate)
        if expected_company_fx > 0 and Decimal(company_by_key["realized_fx_loss"].debit) != expected_company_fx:
            raise AssertionError("company investor principal settlement FX loss is incorrect")
        cistatement = company_investor_statement(ci["id"], db, tenant)  # type: ignore[arg-type]
        if cistatement["outstanding_capital"] != Decimal("14000.00") or cistatement["profit_paid"] != Decimal("500.00"): raise AssertionError("company investor statement failed")

        # Project investor: agreement and actual funding are separate lifecycle events.
        pi = create_project_investor(ProjectInvestorCreate(project_id=project.id, investor_name=f"CI Project Investor {marker}", currency=currency, committed_amount=Decimal("30000"), investment_date=date(2096, 6, 1), share_type="profit_percent", share_value=Decimal("25"), agreement_reference=f"PI-{marker}"), request("POST", "/capital/project-investors"), db, tenant)  # type: ignore[arg-type]
        if pi["funded_amount"] != Decimal("0.00"): raise AssertionError("project commitment moved cash")
        pif = fund_project_investor(pi["id"], FundingCreate(account_id=acc.id, funding_date=date(2096, 6, 5), amount=Decimal("12000"), reference=f"PIF-{marker}"), request("POST", f"/capital/project-investors/{pi['id']}/fundings"), db, tenant)  # type: ignore[arg-type]
        if pif["funded_amount"] != Decimal("12000.00") or pif["outstanding_commitment"] != Decimal("18000.00"): raise AssertionError("project funding totals failed")
        po = payout(pi["id"], PayoutCreate(account_id=acc.id, payout_date=date(2096, 7, 1), principal_return_amount=Decimal("2000"), profit_share_amount=Decimal("1000"), reference=f"PO-{marker}"), request("POST", f"/capital/project-investors/{pi['id']}/payouts"), db, tenant)  # type: ignore[arg-type]
        if po["profit_share_amount"] != Decimal("1000.00"): raise AssertionError("project investor payout failed")

        project_payout_journal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "investor_payout",
            JournalEntry.source_id == po["id"],
            JournalEntry.status == "posted",
        ))
        if project_payout_journal is None: raise AssertionError("project investor payout journal missing")
        project_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == project_payout_journal.id)
        ).all()
        project_by_key = {key: line for line, key in project_lines}
        if Decimal(project_by_key["investor_funds_payable"].debit) != Decimal("2000") * historical_rate:
            raise AssertionError("project investor principal payout did not clear historical carrying value")
        if Decimal(project_by_key["investor_profit_share"].debit) != Decimal("1000") * settlement_rate:
            raise AssertionError("project investor profit share expense is incorrect")
        expected_project_fx = Decimal("2000") * (settlement_rate - historical_rate)
        if expected_project_fx > 0 and Decimal(project_by_key["realized_fx_loss"].debit) != expected_project_fx:
            raise AssertionError("project investor principal settlement FX loss is incorrect")
        pistatement = project_investor_statement(pi["id"], db, tenant)  # type: ignore[arg-type]
        if pistatement["outstanding_capital"] != Decimal("10000.00"): raise AssertionError("project investor statement failed")

        owner_contribution = create_owner_equity_transaction(
            OwnerEquityCreate(
                transaction_type="contribution",
                account_id=base_account.id,
                transaction_date=date(2096, 8, 1),
                amount=Decimal("10000"),
                reference=f"OWNER-IN-{marker}",
            ),
            request("POST", "/capital/owner-equity"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        owner_drawing = create_owner_equity_transaction(
            OwnerEquityCreate(
                transaction_type="drawing",
                account_id=base_account.id,
                transaction_date=date(2096, 8, 2),
                amount=Decimal("2500"),
                reference=f"OWNER-OUT-{marker}",
            ),
            request("POST", "/capital/owner-equity"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        for item, expected_key, side, expected_amount in (
            (owner_contribution, "owners_equity", "credit", Decimal("10000")),
            (owner_drawing, "equity_distributions", "debit", Decimal("2500")),
        ):
            journal = db.scalar(select(JournalEntry).where(
                JournalEntry.organization_id == tenant.organization_id,
                JournalEntry.source_type == "owner_equity",
                JournalEntry.source_id == item["id"],
                JournalEntry.status == "posted",
            ))
            if journal is None: raise AssertionError("owner equity journal missing")
            line = db.execute(
                select(JournalLine, LedgerAccount.system_key)
                .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
                .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == journal.id, LedgerAccount.system_key == expected_key)
            ).first()
            if line is None or Decimal(getattr(line[0], side)) != expected_amount:
                raise AssertionError(f"owner equity {item['transaction_type']} posting is incorrect")

        equity_investor = create_company_investor(
            CompanyInvestorCreate(
                investor_name=f"CI Equity Investor {marker}",
                investor_type="individual",
                instrument="equity",
                currency=tenant.organization.currency,
                committed_amount=Decimal("5000"),
                ownership_percent=Decimal("1"),
                agreement_date=date(2096, 8, 3),
                agreement_reference=f"EQ-{marker}",
            ),
            request("POST", "/capital/company-investors"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        equity_funding = fund_company_investor(
            equity_investor["id"],
            FundingCreate(account_id=base_account.id, funding_date=date(2096, 8, 3), amount=Decimal("5000"), reference=f"EQF-{marker}"),
            request("POST", f"/capital/company-investors/{equity_investor['id']}/fundings"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        equity_payout = company_investor_payout(
            equity_investor["id"],
            PayoutCreate(account_id=base_account.id, payout_date=date(2096, 8, 4), principal_return_amount=Decimal("1000"), profit_share_amount=Decimal("500"), reference=f"EQP-{marker}"),
            request("POST", f"/capital/company-investors/{equity_investor['id']}/payouts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        equity_journal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "company_investor_payout",
            JournalEntry.source_id == equity_payout["id"],
            JournalEntry.status == "posted",
        ))
        equity_distribution = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == equity_journal.id)
        ).all() if equity_journal else []
        equity_by_key = {key: line for line, key in equity_distribution}
        if Decimal(equity_by_key["share_capital"].debit) != Decimal("1000.00") or Decimal(equity_by_key["equity_distributions"].debit) != Decimal("500.00"):
            raise AssertionError("equity investor payout must reduce equity/distributions, not P&L expense")
        if equity_funding["funded_amount"] != Decimal("5000.00"):
            raise AssertionError("equity investor funding failed")

        reverse_business_transaction(
            CorrectionRequest(source_type="owner_equity",source_id=owner_drawing["id"],reason="CI owner drawing correction",reversal_date=date(2096,8,5)),
            request("POST","/accounting/corrections/reverse"),db,tenant,  # type: ignore[arg-type]
        )
        owner_reversal=db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.organization_id==tenant.organization_id,
            FinancialTransaction.source_type=="owner_equity_reversal",
            FinancialTransaction.source_id==owner_drawing["id"],
        ))
        if owner_reversal is None or owner_reversal.direction!="credit":
            raise AssertionError("owner drawing reversal did not restore cash/equity")

        refs = [f"INV-{marker}", f"INV2-{marker}", f"RET-{marker}", f"CIF-{marker}", f"CIP-{marker}", f"PIF-{marker}", f"PO-{marker}", f"OWNER-IN-{marker}", f"OWNER-OUT-{marker}", f"EQF-{marker}", f"EQP-{marker}"]
        sources = set(db.scalars(select(FinancialTransaction.source_type).where(FinancialTransaction.organization_id == tenant.organization_id, FinancialTransaction.reference.in_(refs))).all())
        expected = {"company_investment_funding", "investment_return", "company_investor_funding", "company_investor_payout", "project_investor_funding", "investor_payout", "owner_equity"}
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
    print("capital verification passed: historical carrying values + realized FX + owner equity + equity distributions + funding/investment journals")


if __name__ == "__main__":
    main()
