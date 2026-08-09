"""seed HR defaults

Revision ID: 0024_hr_defaults
Revises: 0023_hr_suite
Create Date: 2026-08-09
"""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0024_hr_defaults"
down_revision: str | None = "0023_hr_suite"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("""
        UPDATE organization_roles
        SET permissions = CASE
            WHEN permissions ? '*' THEN permissions
            WHEN permissions ? 'hr.self' THEN permissions
            ELSE permissions || '[\"hr.self\"]'::jsonb
        END
        WHERE slug = 'user' AND is_system = true
    """))
    op.execute(sa.text("""
        INSERT INTO leave_types
            (id, organization_id, name, code, annual_allowance_days, is_paid, requires_approval, is_active, created_at)
        SELECT md5(o.id || ':' || x.code), o.id, x.name, x.code, x.days, x.is_paid, true, true, now()
        FROM organizations o
        CROSS JOIN (VALUES
            ('Annual Leave', 'ANNUAL', 20.00, true),
            ('Sick Leave', 'SICK', 10.00, true),
            ('Unpaid Leave', 'UNPAID', 0.00, false)
        ) AS x(name, code, days, is_paid)
        WHERE NOT EXISTS (
            SELECT 1 FROM leave_types lt WHERE lt.organization_id=o.id AND lt.code=x.code
        )
    """))


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM leave_types WHERE code IN ('ANNUAL','SICK','UNPAID')"))
    op.execute(sa.text("""
        UPDATE organization_roles
        SET permissions = permissions - 'hr.self'
        WHERE slug='user' AND is_system=true AND NOT (permissions ? '*')
    """))
