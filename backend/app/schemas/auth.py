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


class UserProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    timezone: str | None = Field(default=None, max_length=64)


class PasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class GooglePasswordSetupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credential: str = Field(min_length=100, max_length=16_384)
    new_password: str = Field(min_length=8, max_length=128)


class SignUpRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=100, max_length=16_384)


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(min_length=20)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserRead
