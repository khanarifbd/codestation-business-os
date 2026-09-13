from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class OrderBillingInvoiceLink(TenantOwnedMixin, Base):
    __tablename__ = "order_billing_invoice_links"
    __table_args__ = (
        UniqueConstraint("organization_id", "invoice_id", name="uq_order_billing_links_org_invoice"),
        Index("ix_order_billing_links_org_milestone", "organization_id", "billing_milestone_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    billing_milestone_id: Mapped[str] = mapped_column(String(36), ForeignKey("order_billing_milestones.id", ondelete="CASCADE"), nullable=False)
    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
