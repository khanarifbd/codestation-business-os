from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class ClientExternalProfile(TenantOwnedMixin, Base):
    __tablename__ = "client_external_profiles"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "client_id",
            "profile_url",
            name="uq_client_external_profiles_org_client_url",
        ),
        Index("ix_client_external_profiles_org_client", "organization_id", "client_id"),
        Index("ix_client_external_profiles_org_platform", "organization_id", "platform"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("clients.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[str] = mapped_column(String(64), nullable=False)
    profile_url: Mapped[str] = mapped_column(String(500), nullable=False)
    username_handle: Mapped[str | None] = mapped_column(String(160), nullable=True)
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
