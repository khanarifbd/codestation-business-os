from sqlalchemy import text

from app.db.session import engine

EXPECTED = {
    "ix_invoices_org_issue_status_currency": ("invoices", ["organization_id", "issue_date", "status", "currency"]),
    "ix_payments_org_date_status_currency": ("payments", ["organization_id", "payment_date", "status", "invoice_currency"]),
    "ix_expenses_org_date_status_currency": ("expenses", ["organization_id", "expense_date", "status", "expense_currency"]),
    "ix_account_transfers_org_date_status_currency": ("account_transfers", ["organization_id", "transfer_date", "status", "source_currency"]),
    "ix_project_tasks_org_due_status": ("project_tasks", ["organization_id", "due_date", "status"]),
    "ix_leads_org_followup_status": ("leads", ["organization_id", "next_follow_up_at", "status_id"]),
}


def main() -> None:
    with engine.begin() as connection:
        rows = connection.execute(text("""
            SELECT
                indexname,
                tablename,
                indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = ANY(:names)
        """), {"names": list(EXPECTED)}).mappings().all()

    found = {row["indexname"]: row for row in rows}
    missing = sorted(set(EXPECTED) - set(found))
    if missing:
        raise AssertionError(f"Missing performance indexes: {', '.join(missing)}")

    for name, (table, columns) in EXPECTED.items():
        row = found[name]
        if row["tablename"] != table:
            raise AssertionError(f"{name} points to {row['tablename']} instead of {table}")
        definition = row["indexdef"].lower()
        position = -1
        for column in columns:
            next_position = definition.find(column.lower(), position + 1)
            if next_position <= position:
                raise AssertionError(f"{name} does not preserve expected column order: {columns}")
            position = next_position

    print("targeted performance index verification passed")


if __name__ == "__main__":
    main()
