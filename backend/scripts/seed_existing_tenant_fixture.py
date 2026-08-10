from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import text

from app.db.session import engine


def main() -> None:
    now = datetime.now(timezone.utc)
    user_id = str(uuid4())
    organization_id = str(uuid4())

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO users
                    (id, email, full_name, password_hash, system_role, is_active, is_verified,
                     created_at, updated_at)
                VALUES
                    (:id, :email, :full_name, :password_hash, 'user', true, true, :now, :now)
                """
            ),
            {
                "id": user_id,
                "email": f"migration-fixture-{user_id[:8]}@example.com",
                "full_name": "Migration Fixture User",
                "password_hash": "fixture-only",
                "now": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO organizations
                    (id, name, slug, status, country_code, timezone, currency,
                     financial_year_start_month, setup_completed, created_by_user_id,
                     created_at, updated_at)
                VALUES
                    (:id, 'Existing Tenant Fixture', :slug, 'active', 'BD', 'Asia/Dhaka', 'BDT',
                     1, true, :created_by_user_id, :now, :now)
                """
            ),
            {
                "id": organization_id,
                "slug": f"existing-tenant-fixture-{organization_id[:8]}",
                "created_by_user_id": user_id,
                "now": now,
            },
        )

    print(f"seeded existing tenant fixture {organization_id}")


if __name__ == "__main__":
    main()
