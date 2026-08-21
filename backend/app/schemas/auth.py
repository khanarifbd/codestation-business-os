from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str
    system_role: str
    is_active: bool
    is_verified: bool


class UserProfileRead(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    phone: str | None
    timezone: str | None
    system_role: str
    is_active: bool
    is_verified: bool
    has_password: bool
    google_connected: bool
    has_avatar: bool
    avatar_version: int
    created_at: datetime
    updated_at: datetime


class UserSessionRead(BaseModel):
    id: str
    auth_method: str
    device_type: str
    browser: str
    operating_system: str
    ip_address: str | None
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    revoked_reason: str | None
    status: str
    is_current: bool


class UserSessionListRead(BaseModel):
    items: list[UserSessionRead]
    legacy_current_session: bool = False


class UserSessionRevokeResult(BaseModel):
    revoked_count: int


class UserProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    timezone: str | None = Field(default=None, max_length=64)


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class GoogleIdentityLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: str = Field(min_length=100, max_length=16_384)


class GooglePasswordSetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: str = Field(min_length=100, max_length=16_384)
    new_password: str = Field(min_length=8, max_length=128)


class SignUpRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class GoogleLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: str = Field(min_length=100, max_length=16_384)


class RefreshTokenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=20)


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=20, max_length=16_384)
    new_password: str = Field(min_length=8, max_length=128)


class EmailVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=20, max_length=16_384)


class EmailVerificationResendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr


class AuthActionAccepted(BaseModel):
    message: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserRead
