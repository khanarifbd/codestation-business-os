from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.expenses import ExpenseCategory
from app.models.organization import Organization


DEFAULT_EXPENSE_CATEGORIES: tuple[tuple[str, str, str, int], ...] = (
    ("software-subscriptions", "Software & Subscriptions", "operating", 10),
    ("hosting-cloud", "Hosting & Cloud", "direct", 20),
    ("contractor-freelance", "Contractor & Freelance", "direct", 30),
    ("payroll-benefits", "Payroll & Benefits", "operating", 40),
    ("office-utilities", "Office & Utilities", "operating", 50),
    ("marketing-advertising", "Marketing & Advertising", "operating", 60),
    ("travel-transport", "Travel & Transport", "operating", 70),
    ("equipment-hardware", "Equipment & Hardware", "operating", 80),
    ("professional-services", "Professional Services", "operating", 90),
    ("taxes-government-fees", "Taxes & Government Fees", "tax", 100),
    ("bank-financial-charges", "Bank & Financial Charges", "financial", 110),
    ("other", "Other", "other", 999),
)


def ensure_expense_defaults(db: Session, organization: Organization) -> int:
    """Ensure the standard expense categories exist for one organization.

    The caller owns the transaction and audit record. Existing categories are
    never overwritten; only missing default slugs are inserted.
    """

    existing_slugs = set(
        db.scalars(
            select(ExpenseCategory.slug).where(
                ExpenseCategory.organization_id == organization.id
            )
        ).all()
    )
    created = 0
    for slug, name, cost_type, sort_order in DEFAULT_EXPENSE_CATEGORIES:
        if slug in existing_slugs:
            continue
        db.add(
            ExpenseCategory(
                organization_id=organization.id,
                name=name,
                slug=slug,
                cost_type=cost_type,
                is_active=True,
                sort_order=sort_order,
            )
        )
        created += 1
    return created
