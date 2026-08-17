from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.profile import change_password, get_profile, update_profile
from app.core.security import hash_password, verify_password
from app.db.session import SessionLocal
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.auth import PasswordChangeRequest, UserProfileUpdateRequest


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


def main() -> None:
    db = SessionLocal()
    marker = uuid4().hex[:10]
    old_password = "ProfileOldPass123!"
    new_password = "ProfileNewPass456!"
    try:
        user = User(
            email=f"profile-{marker}@example.com",
            full_name="Profile Tester",
            password_hash=hash_password(old_password),
            is_verified=True,
        )
        google_only = User(
            email=f"google-profile-{marker}@example.com",
            full_name="Google Profile Tester",
            password_hash=None,
            google_subject=f"profile-google-{marker}",
            is_verified=True,
        )
        db.add_all([user, google_only])
        db.commit()
        db.refresh(user)
        db.refresh(google_only)

        initial = get_profile(user)
        if initial.email != user.email or not initial.has_password or initial.google_connected:
            raise AssertionError("password profile metadata is incorrect")

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

        try:
            update_profile(
                UserProfileUpdateRequest(timezone="Invalid/Timezone"),
                req("PATCH", "/profile"),
                db,
                user,
            )
        except HTTPException as exc:
            if exc.status_code != 400:
                raise AssertionError("invalid timezone returned wrong status") from exc
        else:
            raise AssertionError("invalid timezone was accepted")

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

        actions = set(db.scalars(
            select(ActivityLog.action).where(ActivityLog.actor_user_id == user.id)
        ).all())
        required_actions = {"user.profile.updated", "user.password.change_failed", "user.password.changed"}
        if not required_actions.issubset(actions):
            raise AssertionError(f"profile audit actions are incomplete: {actions}")

    finally:
        db.close()

    print("user profile verification passed")


if __name__ == "__main__":
    main()
