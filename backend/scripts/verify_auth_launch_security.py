from uuid import uuid4

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError
from starlette.requests import Request

from app.api.dependencies import get_current_user
from app.api.v1.auth import logout, reset_password, verify_email
from app.api.v1.profile import change_password
from app.core.security import (
    create_access_token,
    create_email_verification_token,
    create_password_reset_token,
    create_refresh_token,
    hash_password,
)
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.auth import EmailVerificationRequest, PasswordChangeRequest, ResetPasswordRequest
from app.schemas.organization import OrganizationCreate
from app.services.activity_log import record_activity
from app.services.auth_rate_limit import enforce_auth_rate_limit


def req(path: str, ip: str = "127.0.0.1") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "raw_path": path.encode(),
            "headers": [(b"x-real-ip", ip.encode())],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": (ip, 50000),
        }
    )


def expect_http_status(callable_, expected_status: int) -> None:
    try:
        callable_()
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise AssertionError(f"expected HTTP {expected_status}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"expected HTTP {expected_status}")


def expect_validation(callable_) -> None:
    try:
        callable_()
    except ValidationError:
        return
    raise AssertionError("expected Pydantic validation failure")


def add_fixture_user(db, user: User, marker: str) -> User:
    db.add(user)
    db.flush()
    record_activity(
        db,
        action="ci.auth_security.user_created",
        scope="system",
        actor_user_id=user.id,
        actor_type="system",
        entity_type="user",
        entity_id=user.id,
        message="Created isolated authentication security verification user",
        metadata={"fixture": "auth_launch_security", "marker": marker},
        request=req("/ci/auth-security/seed"),
    )
    db.commit()
    db.refresh(user)
    return user


def main() -> None:
    marker = uuid4().hex[:10]
    db = SessionLocal()
    try:
        password = "Launch-security-password-123!"
        user = add_fixture_user(
            db,
            User(
                email=f"launch-security-{marker}@example.com",
                full_name="Launch Security User",
                password_hash=hash_password(password),
                is_active=True,
                is_verified=True,
            ),
            marker,
        )

        old_version = int(user.auth_token_version or 0)
        old_access = create_access_token(user.id, old_version)
        old_refresh = create_refresh_token(user.id, old_version)
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=old_access)
        if get_current_user(db, credentials).id != user.id:
            raise AssertionError("fresh access token was not accepted")

        change_password(
            PasswordChangeRequest(
                current_password=password,
                new_password="Launch-security-password-456!",
            ),
            req("/api/v1/profile/password"),
            db,
            user,
        )
        db.refresh(user)
        if int(user.auth_token_version or 0) <= old_version:
            raise AssertionError("password change did not increment auth token version")
        expect_http_status(lambda: get_current_user(db, credentials), 401)

        from app.api.v1.auth import refresh
        from app.schemas.auth import RefreshTokenRequest

        expect_http_status(
            lambda: refresh(
                RefreshTokenRequest(refresh_token=old_refresh),
                req("/api/v1/auth/refresh", "127.0.0.21"),
                db,
            ),
            401,
        )

        current_version = int(user.auth_token_version or 0)
        session_access = create_access_token(user.id, current_version)
        session_refresh = create_refresh_token(user.id, current_version)
        logout(req("/api/v1/auth/logout"), db, user)
        db.refresh(user)
        expect_http_status(
            lambda: get_current_user(
                db,
                HTTPAuthorizationCredentials(scheme="Bearer", credentials=session_access),
            ),
            401,
        )
        expect_http_status(
            lambda: refresh(
                RefreshTokenRequest(refresh_token=session_refresh),
                req("/api/v1/auth/refresh", "127.0.0.22"),
                db,
            ),
            401,
        )

        verify_user = add_fixture_user(
            db,
            User(
                email=f"verify-{marker}@example.com",
                full_name="Verify User",
                password_hash=hash_password("Verify-password-123!"),
                is_active=True,
                is_verified=False,
            ),
            marker,
        )
        verification_token = create_email_verification_token(
            verify_user.id,
            verify_user.email,
            int(verify_user.auth_token_version or 0),
        )
        verify_email(
            EmailVerificationRequest(token=verification_token),
            req("/api/v1/auth/verify-email", "127.0.0.23"),
            db,
        )
        db.refresh(verify_user)
        if not verify_user.is_verified:
            raise AssertionError("email verification did not activate password user")

        reset_version = int(user.auth_token_version or 0)
        reset_token = create_password_reset_token(user.id, user.email, reset_version)
        reset_password(
            ResetPasswordRequest(token=reset_token, new_password="Launch-security-password-789!"),
            req("/api/v1/auth/reset-password", "127.0.0.24"),
            db,
        )
        db.refresh(user)
        if int(user.auth_token_version or 0) <= reset_version:
            raise AssertionError("password reset did not revoke existing sessions")
        expect_http_status(
            lambda: reset_password(
                ResetPasswordRequest(token=reset_token, new_password="Launch-security-password-999!"),
                req("/api/v1/auth/reset-password", "127.0.0.25"),
                db,
            ),
            400,
        )

        expect_validation(lambda: OrganizationCreate(name="Bad Country", country_code="ZZ", timezone="Asia/Dhaka", currency="BDT"))
        expect_validation(lambda: OrganizationCreate(name="Bad Currency", country_code="BD", timezone="Asia/Dhaka", currency="ZZZ"))
        expect_validation(lambda: OrganizationCreate(name="Bad Timezone", country_code="BD", timezone="xx", currency="BDT"))
        valid = OrganizationCreate(name="Valid Locale", country_code="bd", timezone="Asia/Dhaka", currency="bdt")
        if valid.country_code != "BD" or valid.currency != "BDT":
            raise AssertionError("valid locale codes were not normalized")

        limit_ip = f"127.0.1.{int(marker[:2], 16) % 200 + 1}"
        enforce_auth_rate_limit(req("/auth/test", limit_ip), action=f"ci-{marker}", limit=2, window_seconds=60)
        enforce_auth_rate_limit(req("/auth/test", limit_ip), action=f"ci-{marker}", limit=2, window_seconds=60)
        expect_http_status(
            lambda: enforce_auth_rate_limit(
                req("/auth/test", limit_ip),
                action=f"ci-{marker}",
                limit=2,
                window_seconds=60,
            ),
            429,
        )
    finally:
        db.close()

    print("launch auth security verification passed: token revocation, recovery tokens, verification, rate limits, locale validation")


if __name__ == "__main__":
    main()
