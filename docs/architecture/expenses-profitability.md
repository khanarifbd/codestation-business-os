# Expenses & Profitability

## Accounting invariants

- Posted expenses create one debit in the selected financial account ledger.
- Financial amount/account/currency fields are immutable after posting. Incorrect postings are voided and recreated.
- Voiding creates a reversing ledger credit; it does not delete historical expense data.
- Transfer fees are sourced from `financial_transactions.source_type = transfer_fee` and are not duplicated as expense rows.
- Company profit/loss is reported per currency; unrelated currencies are never summed.
- Project-linked expenses are normalized to the project currency for project profitability.
- Client profitability is grouped by client and currency.
- Receipts/documents remain private and are served only through authenticated endpoints.

## Core flow

Expense -> Account Ledger Debit -> Project/Client Cost Attribution -> Profitability

Void Expense -> Reversal Credit -> Expense remains in audit history

## Documents

Expense receipts use the existing private document storage adapter under organization-scoped namespaces. The schema remains compatible with a future S3/R2 storage adapter.
