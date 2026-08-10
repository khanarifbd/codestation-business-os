from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class CompanyLoan(TenantOwnedMixin, Base):
    __tablename__ = "company_loans"
    __table_args__ = (
        Index("ix_company_loans_org_status_due", "organization_id", "status", "maturity_date"),
        Index("ix_company_loans_org_account", "organization_id", "account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lender_name: Mapped[str] = mapped_column(String(220), nullable=False)
    lender_type: Mapped[str] = mapped_column(String(32), default="other", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    principal_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    outstanding_principal: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    annual_interest_rate: Mapped[Decimal] = mapped_column(Numeric(9, 4), default=Decimal("0"), nullable=False)
    loan_date: Mapped[date] = mapped_column(Date, nullable=False)
    maturity_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class LoanRepayment(TenantOwnedMixin, Base):
    __tablename__ = "loan_repayments"
    __table_args__ = (Index("ix_loan_repayments_org_loan_date", "organization_id", "loan_id", "payment_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(String(36), ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    principal_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    interest_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CompanyInvestment(TenantOwnedMixin, Base):
    __tablename__ = "company_investments"
    __table_args__ = (
        Index("ix_company_investments_org_status", "organization_id", "status", "investment_date"),
        Index("ix_company_investments_org_account", "organization_id", "account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    investee_name: Mapped[str] = mapped_column(String(220), nullable=False)
    investment_type: Mapped[str] = mapped_column(String(32), default="other", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    invested_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    carrying_value: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    ownership_percent: Mapped[Decimal | None] = mapped_column(Numeric(9, 4), nullable=True)
    investment_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_exit_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class InvestmentReturn(TenantOwnedMixin, Base):
    __tablename__ = "investment_returns"
    __table_args__ = (Index("ix_investment_returns_org_investment_date", "organization_id", "investment_id", "return_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    investment_id: Mapped[str] = mapped_column(String(36), ForeignKey("company_investments.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    return_date: Mapped[date] = mapped_column(Date, nullable=False)
    return_type: Mapped[str] = mapped_column(String(32), default="profit", nullable=False)
    cash_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    principal_return_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    income_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ProjectInvestor(TenantOwnedMixin, Base):
    __tablename__ = "project_investors"
    __table_args__ = (
        Index("ix_project_investors_org_project_status", "organization_id", "project_id", "status"),
        Index("ix_project_investors_org_account", "organization_id", "account_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    investor_name: Mapped[str] = mapped_column(String(220), nullable=False)
    investor_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    invested_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    investment_date: Mapped[date] = mapped_column(Date, nullable=False)
    share_type: Mapped[str] = mapped_column(String(24), default="profit_percent", nullable=False)
    share_value: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    agreement_reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class InvestorPayout(TenantOwnedMixin, Base):
    __tablename__ = "investor_payouts"
    __table_args__ = (
        UniqueConstraint("organization_id", "investor_id", "reference", name="uq_investor_payouts_org_investor_reference"),
        Index("ix_investor_payouts_org_investor_date", "organization_id", "investor_id", "payout_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    investor_id: Mapped[str] = mapped_column(String(36), ForeignKey("project_investors.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    payout_date: Mapped[date] = mapped_column(Date, nullable=False)
    principal_return_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    profit_share_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
