"""Encrypt third-party payment credentials at rest with a dedicated secret.

The encryption key must be configured on the API server, never sent to the
browser.  Credentials are never serialized or included in business/audit logs.
"""
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.core.config import settings


def _cipher() -> Fernet:
    raw = settings.payment_gateway_encryption_key.strip()
    if not raw:
        raise HTTPException(status_code=503, detail="Payment gateway secure storage is not configured on the server")
    try:
        return Fernet(raw.encode("ascii"))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="Payment gateway encryption configuration is invalid") from exc


def encrypt_gateway_secret(value: str) -> str:
    if not value or not value.strip():
        raise ValueError("A non-empty secret is required")
    return _cipher().encrypt(value.strip().encode()).decode("ascii")


def decrypt_gateway_secret(encrypted_value: str) -> str:
    try:
        return _cipher().decrypt(encrypted_value.encode("ascii")).decode()
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Gateway secret could not be decrypted; contact your administrator") from exc
