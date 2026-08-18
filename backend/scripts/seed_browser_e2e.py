import os

from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.organizations import create_organization
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.membership import Membership
from app.models.user import User
from app.schemas.organization import OrganizationCreate
from app.services.activity_log import record_activity


E2E_EMAIL = os.getenv("E2E_EMAIL", "e2e-owner@example.com").lower().strip()
E2E_PASSWORD = os.getenv("E2E_PASSWORD", "E2E-Launch-Password-123!")


def request(path: str = "/api/v1/organizations") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "raw_path": path.encode(),
            "headers": [(b"x-real-ip", b"127.0.0.1")],
            "query_string": b"",
            "scheme": "http",
            "server": ("127.0.0.1", 8000),
            "client": ("127.0.0.1", 50000),
        }
    )


def main() -> None:
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == E2E_EMAIL))
        if user is None:
            user = User(
                email=E2E_EMAIL,
                full_name="Browser Smoke Owner",
                password_hash=hash_password(E2E_PASSWORD),
                is_active=True,
                is_verified=True,
            )
            db.add(user)
            db.flush()
            record_activity(
                db,
                action="ci.browser_smoke.user_created",
                scope="system",
                actor_user_id=user.id,
                actor_type="system",
                entity_type="user",
                entity_id=user.id,
                message="Created isolated browser smoke user",
                metadata={"fixture": "browser_smoke"},
                request=request("/ci/browser-smoke/seed"),
            )
        else:
            before = {
                "is_active": user.is_active,
                "is_verified": user.is_verified,
                "auth_token_version": int(user.auth_token_version or 0),
            }
            user.password_hash = hash_password(E2E_PASSWORD)
            user.is_active = True
            user.is_verified = True
            record_activity(
                db,
                action="ci.browser_smoke.user_reset",
                scope="system",
                actor_user_id=user.id,
                actor_type="system",
                entity_type="user",
                entity_id=user.id,
                before=before,
                after={
                    "is_active": user.is_active,
                    "is_verified": user.is_verified,
                    "auth_token_version": int(user.auth_token_version or 0),
                },
                message="Reset isolated browser smoke user",
                metadata={"fixture": "browser_smoke"},
                request=request("/ci/browser-smoke/seed"),
            )
        db.commit()
        db.refresh(user)

        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.status == "active",
            )
        )
        if membership is None:
            create_organization(
                OrganizationCreate(
                    name="Browser Smoke Company",
                    country_code="BD",
                    timezone="Asia/Dhaka",
                    currency="BDT",
                    business_type="Software & IT Services",
                    team_size="6-10",
                    financial_year_start_month=1,
                ),
                request(),
                db,
                user,
            )

        print(f"browser smoke fixture ready for {E2E_EMAIL}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
