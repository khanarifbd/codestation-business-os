from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class OrganizationSystemDefaults(TenantOwnedMixin, Base):
    __tablename__ = "organization_system_defaults"
    __table_args__ = (
        UniqueConstraint("organization_id", name="uq_org_system_defaults_organization_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    default_client_country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    default_client_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    default_document_language: Mapped[str] = mapped_column(String(16), default="en", nullable=False)
    default_lead_status: Mapped[str] = mapped_column(String(64), default="new", nullable=False)
    default_project_status: Mapped[str] = mapped_column(String(64), default="planned", nullable=False)
    default_order_status: Mapped[str] = mapped_column(String(64), default="draft", nullable=False)
    default_invoice_status: Mapped[str] = mapped_column(String(64), default="draft", nullable=False)
    quotation_validity_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
