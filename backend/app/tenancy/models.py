from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, declared_attr, mapped_column


class TenantOwnedMixin:
    """Base mixin for every organization-owned business table.

    Business models should inherit this mixin so an organization_id tenant
    boundary is impossible to forget when a new module is introduced.
    """

    @declared_attr
    def organization_id(cls) -> Mapped[str]:
        return mapped_column(
            String(36),
            ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )


def tenant_index(table_name: str, *columns: str) -> Index:
    suffix = "_".join(columns)
    return Index(
        f"ix_{table_name}_organization_{suffix}",
        "organization_id",
        *columns,
    )


def tenant_unique_constraint(table_name: str, *columns: str) -> UniqueConstraint:
    suffix = "_".join(columns)
    return UniqueConstraint(
        "organization_id",
        *columns,
        name=f"uq_{table_name}_organization_{suffix}",
    )
