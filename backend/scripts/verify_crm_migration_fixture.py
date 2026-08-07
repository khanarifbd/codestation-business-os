from sqlalchemy import text

from app.db.session import engine


def main() -> None:
    with engine.connect() as connection:
        organization_id = connection.scalar(
            text(
                """
                SELECT id
                FROM organizations
                WHERE slug LIKE 'existing-tenant-fixture-%'
                ORDER BY created_at DESC
                LIMIT 1
                """
            )
        )
        if organization_id is None:
            raise RuntimeError("Existing tenant migration fixture was not found")

        status_count = connection.scalar(
            text("SELECT COUNT(*) FROM lead_statuses WHERE organization_id=:organization_id"),
            {"organization_id": organization_id},
        )
        source_count = connection.scalar(
            text("SELECT COUNT(*) FROM lead_sources WHERE organization_id=:organization_id"),
            {"organization_id": organization_id},
        )
        lead_sequence_count = connection.scalar(
            text(
                """
                SELECT COUNT(*)
                FROM organization_document_sequences
                WHERE organization_id=:organization_id AND document_type='lead'
                """
            ),
            {"organization_id": organization_id},
        )

    if status_count != 6:
        raise RuntimeError(f"Expected 6 CRM statuses for existing tenant, found {status_count}")
    if source_count != 9:
        raise RuntimeError(f"Expected 9 CRM sources for existing tenant, found {source_count}")
    if lead_sequence_count != 1:
        raise RuntimeError(
            f"Expected one lead numbering sequence for existing tenant, found {lead_sequence_count}"
        )

    print("CRM existing-tenant migration backfill verification passed")


if __name__ == "__main__":
    main()
