from datetime import datetime
import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

_MAX_CREDENTIAL_JSON_BYTES = 65_536
_MAX_CREDENTIAL_ID_CHARS = 2_048


def _validate_credential_payload(value: dict[str, Any]) -> dict[str, Any]:
    credential_id = value.get("id")
    response = value.get("response")
    if not isinstance(credential_id, str) or not (1 <= len(credential_id) <= _MAX_CREDENTIAL_ID_CHARS):
        raise ValueError("Passkey credential id is invalid")
    if not isinstance(response, dict):
        raise ValueError("Passkey credential response is invalid")
    try:
        encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("Passkey credential payload is invalid") from exc
    if len(encoded) > _MAX_CREDENTIAL_JSON_BYTES:
        raise ValueError("Passkey credential payload is too large")
    return value


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

    @field_validator("credential")
    @classmethod
    def validate_credential(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_credential_payload(value)


class PasskeyAuthenticationVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    challenge_id: str = Field(min_length=36, max_length=36)
    credential: dict[str, Any]

    @field_validator("credential")
    @classmethod
    def validate_credential(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_credential_payload(value)
