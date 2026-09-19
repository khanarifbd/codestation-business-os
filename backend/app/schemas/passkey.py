from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PasskeyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    credential_device_type: str
    backed_up: bool
    transports: list[str]
    created_at: datetime
    last_used_at: datetime | None


class PasskeyRegistrationOptionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str | None = Field(default=None, min_length=8, max_length=128)
    google_credential: str | None = Field(default=None, min_length=100, max_length=16_384)


class PasskeyOptionsRead(BaseModel):
    challenge_id: str
    public_key: dict[str, Any]


class PasskeyRegistrationVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    challenge_id: str = Field(min_length=36, max_length=36)
    name: str = Field(min_length=1, max_length=80)
    credential: dict[str, Any]


class PasskeyAuthenticationVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    challenge_id: str = Field(min_length=36, max_length=36)
    credential: dict[str, Any]
