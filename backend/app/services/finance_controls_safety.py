"""Narrow Controls safeguards; not a global period-close/posting protocol."""
from app.services.accounting_period_gate import acquire_accounting_period_gate


CREDIT_CARD_RECURRING_UNSUPPORTED = (
    "Credit-card accounts are not supported for recurring expense posting. "
    "Use the supported Money Out workflow instead."
)


def lock_accounting_period_creation(db, organization_id: str) -> None:
    """Compatibility alias: acquire the exclusive period gate before creation.

    Controls create/close/reopen participate. Unadopted financial writers do not,
    so this foundation alone does not solve global close-versus-post races.
    """
    acquire_accounting_period_gate(db, organization_id, exclusive=True)
