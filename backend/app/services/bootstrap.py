from sqlalchemy import select

from app.core.config import settings
from app.core.roles import SYSTEM_ROLE_SUPER_ADMIN
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User
from app.services.activity_log import record_activity


def _user_state(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "system_role": user.system_role,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
    }


def ensure_super_admin() -> None:
    """Ensure the platform always has at least one active global super admin.

    Credentials come from environment variables. If no active super admin exists,
    the configured account is created or promoted/reactivated atomically at startup.
    """

    with SessionLocal() as db:
        existing_super_admin = db.scalar(
            select(User)
            .where(
                User.system_role == SYSTEM_ROLE_SUPER_ADMIN,
                User.is_active.is_(True),
            )
            .limit(1)
        )
        if existing_super_admin is not None:
            return

        email = settings.super_admin_email.lower().strip()
        password = settings.super_admin_password
        full_name = settings.super_admin_name.strip() or "CodeStation AI Super Admin"

        if not email or not password:
            raise RuntimeError(
                "No active super admin exists. SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required."
            )

        user = db.scalar(select(User).where(User.email == email))
        before = _user_state(user) if user is not None else None
        if user is None:
            action = "system.super_admin.created"
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
            action = "system.super_admin.recovered"
            user.full_name = full_name
            user.password_hash = hash_password(password)
            user.system_role = SYSTEM_ROLE_SUPER_ADMIN
            user.is_active = True
            user.is_verified = True

        db.flush()
        record_activity(
            db,
            action=action,
            scope="platform",
            actor_type="system",
            entity_type="user",
            entity_id=user.id,
            message="Global super admin ensured from environment configuration",
            before=before,
            after=_user_state(user),
            metadata={"source": "startup_bootstrap"},
        )
        db.commit()
