"""Existing workflow account-type restrictions, shared by preflight and locked reads.

These checks do not acquire locks or authorize a transaction. Mutating callers
must revalidate against their freshly locked account, not just an earlier cache.
"""
from fastapi import HTTPException


def ensure_payment_receipt_account_supported(account_type: str) -> None:
    if account_type == "credit_card":
        raise HTTPException(status_code=400, detail="Customer payments cannot be received into a credit card account")


def ensure_expense_posting_account_supported(account_type: str) -> None:
    if account_type == "credit_card":
        raise HTTPException(
            status_code=400,
            detail=(
                "This expense workflow cannot safely post credit-card liability movements yet. "
                "Use Money Out for credit-card spending until the dedicated card workflow is enabled."
            ),
        )


def ensure_transfer_accounts_supported(source_type: str, destination_type: str) -> None:
    if source_type == "credit_card" or destination_type == "credit_card":
        raise HTTPException(
            status_code=400,
            detail=(
                "Credit card settlement is not an account transfer. "
                "Use a dedicated card payment/expense workflow so the liability direction remains correct."
            ),
        )
