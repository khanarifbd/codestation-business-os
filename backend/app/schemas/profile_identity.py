from pydantic import BaseModel, ConfigDict, EmailStr, Field


class SignInIdentitiesRead(BaseModel):
    email: EmailStr
    email_verified: bool
    username: str | None
    google_connected: bool
    has_password: bool


class UsernameUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str | None = Field(default=None, max_length=32)
