from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now


class UserPasskey(Base):
    __tablename__ = "user_passkeys"
    __table_args__ = (
        Index("ix_user_passkeys_user_created", "user_id", "created_at"),
        Index("ix_user_passkeys_credential_hash", "credential_id_hash", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    credential_id: Mapped[str] = mapped_column(Text, nullable=False)
    credential_id_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    credential_public_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    credential_device_type: Mapped[str] = mapped_column(String(24), nullable=False)
    backed_up: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    transports: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    aaguid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PasskeyChallenge(Base):
    __tablename__ = "passkey_challenges"
    __table_args__ = (
        Index("ix_passkey_challenges_purpose_expiry", "purpose", "expires_at"),
        Index("ix_passkey_challenges_user_purpose", "user_id", "purpose"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    challenge: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
