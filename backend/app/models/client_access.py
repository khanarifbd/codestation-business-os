from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class ClientMembership(TenantOwnedMixin, Base):
    """Links a global user membership to a tenant CRM client record.

    A client company may have multiple portal users and one user may represent more
    than one client record in the same organization. This relationship is separate
    from staff authorization, so an employee can also be a client without losing
    their employee role or permissions.
    """

    __tablename__ = "client_memberships"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "client_id",
            "membership_id",
            name="uq_client_memberships_org_client_membership",
        ),
        Index("ix_client_memberships_org_membership", "organization_id", "membership_id"),
        Index("ix_client_memberships_org_client", "organization_id", "client_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    membership_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("memberships.id", ondelete="CASCADE"), nullable=False
    )
    is_primary_contact: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
