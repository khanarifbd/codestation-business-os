from sqlalchemy import select

from app.core.config import settings
from app.core.roles import SYSTEM_ROLE_SUPER_ADMIN
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User


def ensure_super_admin() -> None:
    """Ensure the platform always has at least one global super admin.

    Credentials come from environment variables. If no super admin exists,
    the configured account is created or promoted atomically at startup.
    """

    with SessionLocal() as db:
        existing_super_admin = db.scalar(
            select(User).where(User.system_role == SYSTEM_ROLE_SUPER_ADMIN).limit(1)
        )
        if existing_super_admin is not None:
            return

        email = settings.super_admin_email.lower().strip()
        password = settings.super_admin_password
        full_name = settings.super_admin_name.strip() or "CodeStation AI Super Admin"

        if not email or not password:
            raise RuntimeError(
                "No super admin exists. SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required."
            )

        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                full_name=full_name,
                password_hash=hash_password(password),
                system_role=SYSTEM_ROLE_SUPER_ADMIN,
                is_active=True,
                is_verified=True,
            )
            db.add(user)
        else:
            user.full_name = full_name
            user.password_hash = hash_password(password)
            user.system_role = SYSTEM_ROLE_SUPER_ADMIN
            user.is_active = True
            user.is_verified = True

        db.commit()
