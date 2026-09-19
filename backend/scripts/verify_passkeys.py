from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.main import app
from app.models.passkey import PasskeyChallenge, UserPasskey
from app.schemas.passkey import PasskeyAuthenticationVerifyRequest, PasskeyRegistrationVerifyRequest
from app.services.passkeys import authentication_options, credential_id_hash, relying_party


ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    paths = app.openapi().get("paths", {})
    for path, method in (
        ("/api/v1/auth/passkeys/options", "post"),
        ("/api/v1/auth/passkeys/verify", "post"),
        ("/api/v1/profile/passkeys", "get"),
        ("/api/v1/profile/passkeys/registration/options", "post"),
        ("/api/v1/profile/passkeys/registration/verify", "post"),
        ("/api/v1/profile/passkeys/{passkey_id}", "delete"),
    ):
        if method not in paths.get(path, {}):
            raise AssertionError(f"missing passkey API operation: {method.upper()} {path}")

    if "organization_id" in UserPasskey.__table__.columns:
        raise AssertionError("passkeys are global user identities and must not be tenant-scoped")
    for required in (
        "credential_id_hash",
        "credential_public_key",
        "sign_count",
        "credential_device_type",
        "backed_up",
        "last_used_at",
    ):
        if required not in UserPasskey.__table__.columns:
            raise AssertionError(f"passkey persistence is missing {required}")

    rp_id, origin = relying_party()
    if not rp_id or not origin.startswith(("http://", "https://")):
        raise AssertionError("passkey RP/origin configuration is invalid")

    if credential_id_hash("AQID") != credential_id_hash("AQID"):
        raise AssertionError("passkey credential hashing must be deterministic")

    valid_credential = {"id": "AQID", "response": {}}
    PasskeyAuthenticationVerifyRequest(challenge_id="00000000-0000-0000-0000-000000000000", credential=valid_credential)
    PasskeyRegistrationVerifyRequest(
        challenge_id="00000000-0000-0000-0000-000000000000",
        name="Test passkey",
        credential=valid_credential,
    )
    oversized_rejected = False
    try:
        PasskeyAuthenticationVerifyRequest(
            challenge_id="00000000-0000-0000-0000-000000000000",
            credential={"id": "A" * 2_049, "response": {}},
        )
    except ValueError:
        oversized_rejected = True
    if not oversized_rejected:
        raise AssertionError("oversized passkey credential identifiers must be rejected")

    with SessionLocal() as db:
        challenge, options = authentication_options(db)
        if options.get("rpId") != rp_id:
            raise AssertionError("authentication options use the wrong RP ID")
        if options.get("userVerification") != "required":
            raise AssertionError("passkey sign-in must require user verification")
        if options.get("allowCredentials") not in (None, []):
            raise AssertionError("passkey login must remain discoverable/passwordless")
        persisted = db.scalar(select(PasskeyChallenge).where(PasskeyChallenge.id == challenge.id))
        if persisted is None or persisted.user_id is not None or persisted.purpose != "authentication":
            raise AssertionError("authentication challenge was not persisted correctly")
        if persisted.expires_at <= datetime.now(timezone.utc):
            raise AssertionError("authentication challenge must expire in the future")
        db.execute(delete(PasskeyChallenge.__table__).where(PasskeyChallenge.id == challenge.id))
        db.commit()

    service_source = (ROOT / "backend/app/services/passkeys.py").read_text()
    for fragment in (
        "ResidentKeyRequirement.REQUIRED",
        "UserVerificationRequirement.REQUIRED",
        "require_user_verification=True",
        "verify_registration_step_up",
        "expected_origin=origin",
        "credential_current_sign_count=passkey.sign_count",
    ):
        if fragment not in service_source:
            raise AssertionError(f"passkey security contract missing: {fragment}")

    login_source = (ROOT / "frontend/src/app/login/page.tsx").read_text()
    for fragment in (
        'autoComplete="username webauthn"',
        "conditionalPasskeysSupported",
        "Sign in with a passkey",
    ):
        if fragment not in login_source:
            raise AssertionError(f"passkey login UX contract missing: {fragment}")

    print(
        "Passkey verification passed: global credentials, discoverable WebAuthn login, "
        "server-side challenges, user verification, RP/origin checks, and Security enrollment."
    )


if __name__ == "__main__":
    main()
