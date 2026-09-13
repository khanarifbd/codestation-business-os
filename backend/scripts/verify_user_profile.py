from __future__ import annotations

import time
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from starlette.requests import Request

import app.api.v1.profile as profile_api
from app.api.v1.profile import change_password, get_profile, setup_password_with_google, update_profile
from app.core.security import hash_password, verify_password
from app.db.session import SessionLocal
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.auth import GooglePasswordSetupRequest, PasswordChangeRequest, UserProfileUpdateRequest
from app.services.activity_log import record_activity
from app.services.google_identity import GoogleIdentity
from app.services.profile_avatar import detect_avatar_content_type


def req(method: str, path: str) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def expect_profile_error(
    db,
    user: User,
    payload: UserProfileUpdateRequest,
    *,
    label: str,
) -> None:
    try:
        update_profile(payload, req("PATCH", "/profile"), db, user)
    except HTTPException as exc:
        if exc.status_code != 400:
            raise AssertionError(f"{label} returned wrong status") from exc
    else:
        raise AssertionError(f"{label} was accepted")


def main() -> None:
    db = SessionLocal()
    marker = uuid4().hex[:10]
    old_password = "ProfileOldPass123!"
    new_password = "ProfileNewPass456!"
    google_password = "GooglePassword789!"
    original_google_verifier = profile_api.verify_google_id_token
    try:
        user = User(
            email=f"profile-{marker}@example.com",
            full_name="Profile Tester",
            password_hash=hash_password(old_password),
            is_verified=True,
        )
        google_only = User(
            email=f"google-profile-{marker}@gmail.com",
            full_name="Google Profile Tester",
            password_hash=None,
            google_subject=f"profile-google-{marker}",
            is_verified=True,
        )
        db.add_all([user, google_only])
        db.flush()
        for fixture_user, provider in ((user, "password"), (google_only, "google")):
            record_activity(
                db,
                action="auth.user.created",
                scope="auth",
                actor_user_id=fixture_user.id,
                entity_type="user",
                entity_id=fixture_user.id,
                message="User profile verification fixture created",
                after={
                    "id": fixture_user.id,
                    "email": fixture_user.email,
                    "full_name": fixture_user.full_name,
                    "provider": provider,
                },
                request=req("POST", "/profile-verification-fixture"),
            )
        db.commit()
        db.refresh(user)
        db.refresh(google_only)

        initial = get_profile(user)
        if initial.email != user.email or not initial.has_password or initial.google_connected:
            raise AssertionError("password profile metadata is incorrect")
        if initial.has_avatar or initial.avatar_version != 0:
            raise AssertionError("new profile avatar metadata is incorrect")

        if detect_avatar_content_type(b"\x89PNG\r\n\x1a\nprofile") != "image/png":
            raise AssertionError("PNG avatar signature was not detected")
        if detect_avatar_content_type(b"\xff\xd8\xffprofile") != "image/jpeg":
            raise AssertionError("JPEG avatar signature was not detected")
        if detect_avatar_content_type(b"RIFFxxxxWEBPprofile") != "image/webp":
            raise AssertionError("WebP avatar signature was not detected")
        if detect_avatar_content_type(b"<svg></svg>") is not None:
            raise AssertionError("unsupported avatar data was accepted")

        updated = update_profile(
            UserProfileUpdateRequest(
                full_name="Updated Profile Tester",
                phone="+880 1700-000000",
                timezone="Asia/Dhaka",
            ),
            req("PATCH", "/profile"),
            db,
            user,
        )
        if updated.full_name != "Updated Profile Tester" or updated.phone != "+880 1700-000000":
            raise AssertionError("profile fields were not updated")
        if updated.timezone != "Asia/Dhaka" or updated.email != user.email:
            raise AssertionError("profile timezone/email behavior is incorrect")

        try:
            UserProfileUpdateRequest.model_validate({"email": "attacker@example.com"})
        except ValidationError:
            pass
        else:
            raise AssertionError("profile update schema accepted direct email mutation")

        expect_profile_error(
            db,
            user,
            UserProfileUpdateRequest(timezone="Invalid/Timezone"),
            label="unknown timezone",
        )
        expect_profile_error(
            db,
            user,
            UserProfileUpdateRequest(timezone="../UTC"),
            label="malformed timezone",
        )
        expect_profile_error(
            db,
            user,
            UserProfileUpdateRequest(phone="++++"),
            label="punctuation-only phone number",
        )

        try:
            change_password(
                PasswordChangeRequest(current_password="WrongPassword123!", new_password=new_password),
                req("POST", "/profile/password"),
                db,
                user,
            )
        except HTTPException as exc:
            if exc.status_code != 400:
                raise AssertionError("wrong current password returned wrong status") from exc
        else:
            raise AssertionError("wrong current password was accepted")

        try:
            change_password(
                PasswordChangeRequest(current_password=old_password, new_password=old_password),
                req("POST", "/profile/password"),
                db,
                user,
            )
        except HTTPException as exc:
            if exc.status_code != 400:
                raise AssertionError("password reuse returned wrong status") from exc
        else:
            raise AssertionError("password reuse was accepted")

        change_password(
            PasswordChangeRequest(current_password=old_password, new_password=new_password),
            req("POST", "/profile/password"),
            db,
            user,
        )
        db.refresh(user)
        if user.password_hash is None or not verify_password(new_password, user.password_hash):
            raise AssertionError("new password was not persisted")
        if verify_password(old_password, user.password_hash):
            raise AssertionError("old password still verifies after password change")

        google_profile = get_profile(google_only)
        if google_profile.has_password or not google_profile.google_connected:
            raise AssertionError("Google-only profile metadata is incorrect")
        try:
            change_password(
                PasswordChangeRequest(current_password="UnusedPass123!", new_password="AnotherPass456!"),
                req("POST", "/profile/password"),
                db,
                google_only,
            )
        except HTTPException as exc:
            if exc.status_code != 409:
                raise AssertionError("Google-only password change returned wrong status") from exc
        else:
            raise AssertionError("Google-only account was allowed to create a password without re-authentication")

        def mismatched_google(_: str) -> GoogleIdentity:
            return GoogleIdentity(
                subject=f"different-{marker}",
                email=google_only.email,
                full_name=google_only.full_name,
                hosted_domain=None,
                picture_url=None,
                issued_at=int(time.time()),
            )

        profile_api.verify_google_id_token = mismatched_google
        try:
            setup_password_with_google(
                GooglePasswordSetupRequest(credential="g" * 120, new_password=google_password),
                req("POST", "/profile/password/google-setup"),
                db,
                google_only,
            )
        except HTTPException as exc:
            if exc.status_code != 403:
                raise AssertionError("mismatched Google re-auth returned wrong status") from exc
        else:
            raise AssertionError("different Google identity was allowed to create a password")

        def linked_google(_: str) -> GoogleIdentity:
            return GoogleIdentity(
                subject=google_only.google_subject or "",
                email=google_only.email,
                full_name=google_only.full_name,
                hosted_domain=None,
                picture_url=None,
                issued_at=int(time.time()),
            )

        profile_api.verify_google_id_token = linked_google
        secured_profile = setup_password_with_google(
            GooglePasswordSetupRequest(credential="g" * 120, new_password=google_password),
            req("POST", "/profile/password/google-setup"),
            db,
            google_only,
        )
        db.refresh(google_only)
        if not secured_profile.has_password or google_only.password_hash is None:
            raise AssertionError("Google re-auth did not enable password sign-in")
        if not verify_password(google_password, google_only.password_hash):
            raise AssertionError("Google-created password was not persisted")

        user_logs = list(db.scalars(
            select(ActivityLog).where(ActivityLog.actor_user_id == user.id)
        ).all())
        actions = {log.action for log in user_logs}
        required_actions = {"user.profile.updated", "user.password.change_failed", "user.password.changed"}
        if not required_actions.issubset(actions):
            raise AssertionError(f"profile audit actions are incomplete: {actions}")

        password_failure_reasons = {
            (log.metadata_json or {}).get("reason")
            for log in user_logs
            if log.action == "user.password.change_failed"
        }
        if not {"incorrect_current_password", "password_reuse"}.issubset(password_failure_reasons):
            raise AssertionError(
                f"password failure audit reasons are incomplete: {password_failure_reasons}"
            )

        google_actions = set(db.scalars(
            select(ActivityLog.action).where(ActivityLog.actor_user_id == google_only.id)
        ).all())
        if not {"user.password.change_failed", "user.password.setup_failed", "user.password.setup"}.issubset(google_actions):
            raise AssertionError(f"Google password setup audit actions are incomplete: {google_actions}")

    finally:
        profile_api.verify_google_id_token = original_google_verifier
        db.close()

    print("user profile verification passed")


if __name__ == "__main__":
    main()
