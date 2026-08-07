from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.roles import MEMBERSHIP_ROLE_USER, MEMBERSHIP_STATUS_ACTIVE
from app.db.base import Base
from app.models.common import new_uuid, utc_now


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_membership_org_user"),
        Index(
            "ix_memberships_user_status_org",
            "user_id",
            "status",
            "organization_id",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organization_roles.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # Compatibility slug for built-in admin/user semantics. Custom authorization
    # is driven by role_id and OrganizationRole.permissions.
    role: Mapped[str] = mapped_column(String(64), default=MEMBERSHIP_ROLE_USER, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default=MEMBERSHIP_STATUS_ACTIVE, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
