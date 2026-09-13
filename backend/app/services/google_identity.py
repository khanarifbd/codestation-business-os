from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}
_SHA256_DIGEST_INFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")
_CLOCK_SKEW_SECONDS = 300
_DEFAULT_JWKS_CACHE_SECONDS = 300
_MAX_JWT_LENGTH = 16_384

_jwks_lock = threading.Lock()
_jwks_by_kid: dict[str, dict[str, Any]] = {}
_jwks_expires_at = 0.0


class GoogleIdentityError(ValueError):
    """The supplied Google credential is not valid for this application."""


class GoogleIdentityConfigurationError(GoogleIdentityError):
    """Google sign-in is not configured on this Business OS deployment."""


class GoogleIdentityUnavailableError(GoogleIdentityError):
    """Google signing keys could not be retrieved right now."""


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    full_name: str
    hosted_domain: str | None
    picture_url: str | None
    issued_at: int | None = None

    @property
    def email_is_google_authoritative(self) -> bool:
        # Google documents Gmail and hosted Google Workspace domains as the
        # cases where the Google account is authoritative for the email owner.
        return self.email.endswith("@gmail.com") or bool(self.hosted_domain)


def _b64url_decode(value: str) -> bytes:
    if not value:
        raise GoogleIdentityError("Malformed Google credential")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, TypeError) as exc:
        raise GoogleIdentityError("Malformed Google credential") from exc


def _json_part(value: str) -> dict[str, Any]:
    try:
        decoded = json.loads(_b64url_decode(value))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GoogleIdentityError("Malformed Google credential") from exc
    if not isinstance(decoded, dict):
        raise GoogleIdentityError("Malformed Google credential")
    return decoded


def _positive_int_claim(payload: dict[str, Any], name: str) -> int:
    value = payload.get(name)
    if isinstance(value, bool):
        raise GoogleIdentityError(f"Google credential has an invalid {name} claim")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise GoogleIdentityError(f"Google credential has an invalid {name} claim") from exc
    if result <= 0:
        raise GoogleIdentityError(f"Google credential has an invalid {name} claim")
    return result


def _cache_seconds(cache_control: str | None) -> int:
    if cache_control:
        for part in cache_control.split(","):
            item = part.strip().lower()
            if item.startswith("max-age="):
                try:
                    seconds = int(item.split("=", 1)[1])
                except ValueError:
                    break
                return max(60, min(seconds, 86_400))
    return _DEFAULT_JWKS_CACHE_SECONDS


def _fetch_google_jwks(*, force: bool = False) -> dict[str, dict[str, Any]]:
    global _jwks_by_kid, _jwks_expires_at

    now = time.time()
    with _jwks_lock:
        if not force and _jwks_by_kid and now < _jwks_expires_at:
            return dict(_jwks_by_kid)

    try:
        response = httpx.get(GOOGLE_JWKS_URL, timeout=5.0, follow_redirects=False)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        raise GoogleIdentityUnavailableError(
            "Google sign-in is temporarily unavailable. Please try again."
        ) from exc

    keys = payload.get("keys") if isinstance(payload, dict) else None
    if not isinstance(keys, list):
        raise GoogleIdentityUnavailableError("Google returned an invalid signing-key response")

    by_kid: dict[str, dict[str, Any]] = {}
    for key in keys:
        if not isinstance(key, dict):
            continue
        kid = key.get("kid")
        if isinstance(kid, str) and kid:
            by_kid[kid] = key
    if not by_kid:
        raise GoogleIdentityUnavailableError("Google returned no usable signing keys")

    expires_at = now + _cache_seconds(response.headers.get("cache-control"))
    with _jwks_lock:
        _jwks_by_kid = by_kid
        _jwks_expires_at = expires_at
    return dict(by_kid)


def _rsa_rs256_signature_valid(
    signing_input: bytes,
    signature: bytes,
    jwk: dict[str, Any],
) -> bool:
    if jwk.get("kty") != "RSA":
        return False
    if jwk.get("use") not in (None, "sig"):
        return False
    if jwk.get("alg") not in (None, "RS256"):
        return False

    n_raw = jwk.get("n")
    e_raw = jwk.get("e")
    if not isinstance(n_raw, str) or not isinstance(e_raw, str):
        return False

    try:
        modulus = int.from_bytes(_b64url_decode(n_raw), "big")
        exponent = int.from_bytes(_b64url_decode(e_raw), "big")
    except GoogleIdentityError:
        return False

    if modulus <= 0 or exponent <= 1:
        return False
    modulus_size = (modulus.bit_length() + 7) // 8
    if len(signature) != modulus_size:
        return False

    signature_int = int.from_bytes(signature, "big")
    if signature_int >= modulus:
        return False

    encoded = pow(signature_int, exponent, modulus).to_bytes(modulus_size, "big")
    digest_info = _SHA256_DIGEST_INFO_PREFIX + hashlib.sha256(signing_input).digest()
    padding_length = modulus_size - len(digest_info) - 3
    if padding_length < 8:
        return False
    expected = b"\x00\x01" + (b"\xff" * padding_length) + b"\x00" + digest_info
    return hmac.compare_digest(encoded, expected)


def verify_google_id_token(
    credential: str,
    *,
    client_id: str | None = None,
    jwks: dict[str, dict[str, Any]] | None = None,
    now: int | None = None,
) -> GoogleIdentity:
    expected_client_id = (client_id or settings.google_oauth_client_id).strip()
    if not expected_client_id:
        raise GoogleIdentityConfigurationError("Google sign-in is not configured")
    if not credential or len(credential) > _MAX_JWT_LENGTH:
        raise GoogleIdentityError("Invalid Google credential")

    parts = credential.split(".")
    if len(parts) != 3:
        raise GoogleIdentityError("Malformed Google credential")
    encoded_header, encoded_payload, encoded_signature = parts
    header = _json_part(encoded_header)
    payload = _json_part(encoded_payload)

    if header.get("alg") != "RS256":
        raise GoogleIdentityError("Unsupported Google credential signature algorithm")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise GoogleIdentityError("Google credential is missing a signing key id")

    keys = jwks if jwks is not None else _fetch_google_jwks()
    key = keys.get(kid)
    if key is None and jwks is None:
        keys = _fetch_google_jwks(force=True)
        key = keys.get(kid)
    if key is None:
        raise GoogleIdentityError("Google credential signing key is not recognized")

    signature = _b64url_decode(encoded_signature)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    if not _rsa_rs256_signature_valid(signing_input, signature, key):
        raise GoogleIdentityError("Google credential signature is invalid")

    issuer = payload.get("iss")
    if issuer not in _ALLOWED_ISSUERS:
        raise GoogleIdentityError("Google credential issuer is invalid")

    audience = payload.get("aud")
    if isinstance(audience, str):
        audience_matches = hmac.compare_digest(audience, expected_client_id)
        multiple_audiences = False
    elif isinstance(audience, list) and all(isinstance(item, str) for item in audience):
        audience_matches = expected_client_id in audience
        multiple_audiences = len(audience) > 1
    else:
        audience_matches = False
        multiple_audiences = False
    if not audience_matches:
        raise GoogleIdentityError("Google credential was not issued for this application")
    if multiple_audiences and payload.get("azp") != expected_client_id:
        raise GoogleIdentityError("Google credential authorized party is invalid")

    current_time = int(time.time()) if now is None else int(now)
    expires_at = _positive_int_claim(payload, "exp")
    if expires_at < current_time - _CLOCK_SKEW_SECONDS:
        raise GoogleIdentityError("Google credential has expired")

    issued_at: int | None = None
    if payload.get("iat") is not None:
        issued_at = _positive_int_claim(payload, "iat")
        if issued_at > current_time + _CLOCK_SKEW_SECONDS:
            raise GoogleIdentityError("Google credential issue time is invalid")
    not_before = payload.get("nbf")
    if not_before is not None and _positive_int_claim(payload, "nbf") > current_time + _CLOCK_SKEW_SECONDS:
        raise GoogleIdentityError("Google credential is not valid yet")

    subject = payload.get("sub")
    email = payload.get("email")
    email_verified = payload.get("email_verified")
    if not isinstance(subject, str) or not subject.strip():
        raise GoogleIdentityError("Google credential is missing the account subject")
    if not isinstance(email, str) or "@" not in email:
        raise GoogleIdentityError("Google credential is missing a valid email")
    if email_verified not in (True, "true", "True", 1):
        raise GoogleIdentityError("Google account email is not verified")

    hosted_domain = payload.get("hd")
    if not isinstance(hosted_domain, str) or not hosted_domain.strip():
        hosted_domain = None
    picture = payload.get("picture")
    if not isinstance(picture, str) or not picture.strip():
        picture = None
    full_name = payload.get("name")
    if not isinstance(full_name, str) or len(full_name.strip()) < 2:
        full_name = email.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
    if len(full_name) < 2:
        full_name = "Google User"

    return GoogleIdentity(
        subject=subject.strip(),
        email=email.lower().strip(),
        full_name=full_name.strip()[:160],
        hosted_domain=hosted_domain.lower().strip() if hosted_domain else None,
        picture_url=picture,
        issued_at=issued_at,
    )
