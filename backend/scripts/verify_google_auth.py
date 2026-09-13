from __future__ import annotations

import base64
import hashlib
import json
import time
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

import app.api.v1.auth as auth_api
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.auth import GoogleLoginRequest, LoginRequest, SignUpRequest
from app.services.google_identity import GoogleIdentity, GoogleIdentityError, verify_google_id_token

CLIENT_ID = "business-os-ci.apps.googleusercontent.com"
KID = "business-os-ci-key"
N_B64 = "jlj1eNKoEPolYHsMbwIPe-kxt9TEPj1k7cEWOSnZ0f8yp1YX4tfUPmBemsinE0xKC5j1SxNqqknEtrNvMcfQS_NduWmJFP2j3LqurctuLZ97QZU6hqU5Csk8Y2E4S1CW3Xc5xAIcXffv13TEwUwYlbuyYy76wEWQV0kdsMLwOjM"
E_B64 = "AQAB"
D_B64 = "SRqEjlVZPMbKlT78RrI_M3qyLt-VHQW4pKWJ_TdyBvfRksCTKct_07z4OPOdYjrGuCgIqVLCb8vMu6txCpa8cNCAy_iVeKQ1izQLnzpWRSnvaIdZf53krxeAWSvNBoSr8vmEFv6IyILfPqTH_BdCQbSx12cEQOhJ6Gtt3_w__7E"
SHA256_DIGEST_INFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


def b64url_bytes(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def encode_json(value: dict[str, object]) -> str:
    return b64url_bytes(json.dumps(value, separators=(",", ":"), sort_keys=True).encode())


def sign_token(payload: dict[str, object]) -> str:
    header = {"alg": "RS256", "kid": KID, "typ": "JWT"}
    header_part = encode_json(header)
    payload_part = encode_json(payload)
    signing_input = f"{header_part}.{payload_part}".encode("ascii")

    modulus = int.from_bytes(b64url_decode(N_B64), "big")
    private_exponent = int.from_bytes(b64url_decode(D_B64), "big")
    modulus_size = (modulus.bit_length() + 7) // 8
    digest_info = SHA256_DIGEST_INFO_PREFIX + hashlib.sha256(signing_input).digest()
    padding_length = modulus_size - len(digest_info) - 3
    encoded_message = b"\x00\x01" + (b"\xff" * padding_length) + b"\x00" + digest_info
    signature_int = pow(int.from_bytes(encoded_message, "big"), private_exponent, modulus)
    signature = signature_int.to_bytes(modulus_size, "big")
    return f"{header_part}.{payload_part}.{b64url_bytes(signature)}"


def req(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 50000),
        }
    )


def identity(*, subject: str, email: str, name: str, hd: str | None = None) -> GoogleIdentity:
    return GoogleIdentity(
        subject=subject,
        email=email,
        full_name=name,
        hosted_domain=hd,
        picture_url=None,
    )


def verify_crypto() -> None:
    now = int(time.time())
    jwks = {
        KID: {
            "kty": "RSA",
            "kid": KID,
            "use": "sig",
            "alg": "RS256",
            "n": N_B64,
            "e": E_B64,
        }
    }
    valid_payload: dict[str, object] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "google-ci-subject",
        "email": "google-ci@gmail.com",
        "email_verified": True,
        "name": "Google CI User",
        "iat": now - 10,
        "exp": now + 3600,
    }
    token = sign_token(valid_payload)
    verified = verify_google_id_token(token, client_id=CLIENT_ID, jwks=jwks, now=now)
    if verified.subject != "google-ci-subject" or verified.email != "google-ci@gmail.com":
        raise AssertionError("valid Google ID token did not return the expected identity")
    if not verified.email_is_google_authoritative:
        raise AssertionError("Gmail identity should be authoritative for its email")

    wrong_audience = dict(valid_payload)
    wrong_audience["aud"] = "wrong-client.apps.googleusercontent.com"
    try:
        verify_google_id_token(sign_token(wrong_audience), client_id=CLIENT_ID, jwks=jwks, now=now)
    except GoogleIdentityError:
        pass
    else:
        raise AssertionError("Google token with the wrong audience was accepted")

    expired = dict(valid_payload)
    expired["exp"] = now - 600
    try:
        verify_google_id_token(sign_token(expired), client_id=CLIENT_ID, jwks=jwks, now=now)
    except GoogleIdentityError:
        pass
    else:
        raise AssertionError("expired Google token was accepted")

    header_part, payload_part, signature_part = token.split(".")
    tampered_payload = dict(valid_payload)
    tampered_payload["email"] = "attacker@gmail.com"
    tampered = f"{header_part}.{encode_json(tampered_payload)}.{signature_part}"
    try:
        verify_google_id_token(tampered, client_id=CLIENT_ID, jwks=jwks, now=now)
    except GoogleIdentityError:
        pass
    else:
        raise AssertionError("tampered Google token was accepted")


def password_signup_user(db, email: str, full_name: str) -> User:
    # Password signup intentionally returns only an accepted action now: no session
    # exists until mailbox ownership is verified. Google linking verification needs
    # the persisted account id, so retrieve the user from the database explicitly.
    auth_api.signup(
        SignUpRequest(email=email, full_name=full_name, password="StrongPass123!"),
        req("POST", "/auth/signup"),
        db,
    )
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        raise AssertionError("password signup did not persist the pending verified account")
    return user


def verify_account_flow() -> None:
    marker = uuid4().hex[:10]
    db = SessionLocal()
    original_verifier = auth_api.verify_google_id_token
    current_identity: dict[str, GoogleIdentity] = {}

    def fake_verifier(_: str) -> GoogleIdentity:
        return current_identity["value"]

    auth_api.verify_google_id_token = fake_verifier
    try:
        google_email = f"google-new-{marker}@gmail.com"
        current_identity["value"] = identity(
            subject=f"new-{marker}",
            email=google_email,
            name="Google New User",
        )
        google_result = auth_api.google_login(
            GoogleLoginRequest(credential="g" * 120),
            req("POST", "/auth/google"),
            db,
        )
        google_user = db.get(User, google_result.user.id)
        if google_user is None or google_user.google_subject != f"new-{marker}":
            raise AssertionError("Google signup did not persist the stable Google subject")
        if google_user.password_hash is not None or not google_user.is_verified:
            raise AssertionError("Google-only account password/verification state is incorrect")

        try:
            auth_api.login(
                LoginRequest(email=google_email, password="password123"),
                req("POST", "/auth/login"),
                db,
            )
        except HTTPException as exc:
            if exc.status_code != 401:
                raise AssertionError(f"Google-only password login returned {exc.status_code}") from exc
        else:
            raise AssertionError("Google-only account unexpectedly accepted a password")

        gmail_email = f"existing-{marker}@gmail.com"
        password_user = password_signup_user(db, gmail_email, "Existing Gmail User")
        current_identity["value"] = identity(
            subject=f"gmail-{marker}",
            email=gmail_email,
            name="Existing Gmail User",
        )
        linked_result = auth_api.google_login(
            GoogleLoginRequest(credential="g" * 120),
            req("POST", "/auth/google"),
            db,
        )
        if linked_result.user.id != password_user.id:
            raise AssertionError("Gmail Google sign-in created a duplicate existing user")
        linked_user = db.get(User, password_user.id)
        if linked_user is None or linked_user.google_subject != f"gmail-{marker}" or not linked_user.is_verified:
            raise AssertionError("existing Gmail user was not safely linked and verified")

        workspace_email = f"owner-{marker}@workspace.example"
        workspace_user = password_signup_user(db, workspace_email, "Workspace Owner")
        current_identity["value"] = identity(
            subject=f"workspace-{marker}",
            email=workspace_email,
            name="Workspace Owner",
            hd="workspace.example",
        )
        linked_workspace = auth_api.google_login(
            GoogleLoginRequest(credential="g" * 120),
            req("POST", "/auth/google"),
            db,
        )
        if linked_workspace.user.id != workspace_user.id:
            raise AssertionError("Google Workspace sign-in created a duplicate existing user")

        third_party_email = f"legacy-{marker}@example.com"
        third_party_user = password_signup_user(db, third_party_email, "Legacy User")
        current_identity["value"] = identity(
            subject=f"third-party-{marker}",
            email=third_party_email,
            name="Legacy User",
        )
        try:
            auth_api.google_login(
                GoogleLoginRequest(credential="g" * 120),
                req("POST", "/auth/google"),
                db,
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                raise AssertionError(f"third-party email auto-link returned {exc.status_code}") from exc
        else:
            raise AssertionError("non-authoritative Google email auto-linked to an existing password account")
        legacy_user = db.get(User, third_party_user.id)
        if legacy_user is None or legacy_user.google_subject is not None:
            raise AssertionError("blocked third-party Google link mutated the existing user")

        subjects = db.scalars(
            select(User.google_subject).where(User.google_subject.is_not(None))
        ).all()
        if len(subjects) != len(set(subjects)):
            raise AssertionError("duplicate Google subjects exist")
    finally:
        auth_api.verify_google_id_token = original_verifier
        db.close()


def main() -> None:
    verify_crypto()
    verify_account_flow()
    print("Google ID-token verification, account linking and Google-only login verification passed")


if __name__ == "__main__":
    main()
