import os

from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.organizations import create_organization
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.membership import Membership
from app.models.user import User
from app.schemas.organization import OrganizationCreate


E2E_EMAIL = os.getenv("E2E_EMAIL", "e2e-owner@business-os.local").lower().strip()
E2E_PASSWORD = os.getenv("E2E_PASSWORD", "E2E-Launch-Password-123!")


def request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/organizations",
            "raw_path": b"/api/v1/organizations",
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
        else:
            user.password_hash = hash_password(E2E_PASSWORD)
            user.is_active = True
            user.is_verified = True
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
