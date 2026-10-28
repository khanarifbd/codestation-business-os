"""Append-only payroll policy and adjustment records; no activation defaults."""
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class PayrollPolicyVersion(TenantOwnedMixin, Base):
    __tablename__ = "payroll_policy_versions"
    __table_args__ = (
        UniqueConstraint("organization_id", "id", name="uq_payroll_policy_org_id"),
        UniqueConstraint("organization_id", "version", name="uq_payroll_policy_org_version"),
        CheckConstraint("version > 0", name="ck_payroll_policy_version_positive"),
        Index("ix_payroll_policy_org_effective", "organization_id", "effective_from"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    configuration: Mapped[dict] = mapped_column(JSONB, nullable=False)
    activation_reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PayrollEntryAdjustment(TenantOwnedMixin, Base):
    __tablename__ = "payroll_entry_adjustments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["organization_id", "entry_id"], ["payroll_entries.organization_id", "payroll_entries.id"],
            name="fk_payroll_adjustment_tenant_entry", ondelete="RESTRICT",
        ),
        Index("ix_payroll_adjustment_org_entry_created", "organization_id", "entry_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    entry_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    before_values: Mapped[dict] = mapped_column(JSONB, nullable=False)
    after_values: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
