from app.services.performance_metrics import (
    SLOW_DB_QUERY_MS,
    finish_request_metrics,
    record_db_query,
    start_request_metrics,
)


def _sample_for(statement: str, duration_ms: float = SLOW_DB_QUERY_MS + 25.0):
    metrics, token = start_request_metrics()
    try:
        record_db_query(
            duration_ms,
            statement=statement,
            source="app.api.v1.projects:_detail",
        )
        return metrics.db_slowest_query
    finally:
        finish_request_metrics(token)


def main() -> None:
    first = _sample_for(
        "SELECT projects.id FROM projects "
        "WHERE projects.organization_id = 'tenant-secret-a' AND projects.progress_percent > 10"
    )
    second = _sample_for(
        "SELECT projects.id FROM projects "
        "WHERE projects.organization_id = 'tenant-secret-b' AND projects.progress_percent > 99"
    )

    assert first is not None
    assert second is not None
    assert first.fingerprint == second.fingerprint
    assert first.operation == "SELECT"
    assert first.tables == ("projects",)
    assert first.source == "app.api.v1.projects:_detail"
    assert "tenant-secret" not in repr(first)

    metrics, token = start_request_metrics()
    try:
        record_db_query(
            SLOW_DB_QUERY_MS - 1.0,
            statement="SELECT * FROM clients",
            source="app.api.v1.crm:list_clients",
        )
        assert metrics.db_slow_query_count == 0
        assert metrics.db_slowest_query is None

        record_db_query(
            SLOW_DB_QUERY_MS + 1.0,
            statement="SELECT clients.id FROM clients WHERE clients.organization_id = %(organization_id_1)s",
            source="app.api.v1.crm:list_clients",
        )
        record_db_query(
            SLOW_DB_QUERY_MS + 50.0,
            statement="SELECT projects.id FROM projects JOIN clients ON clients.id = projects.client_id",
            source="app.api.v1.projects:_project_query",
        )
        assert metrics.db_slow_query_count == 2
        assert metrics.db_slowest_query is not None
        assert metrics.db_slowest_query.duration_ms == SLOW_DB_QUERY_MS + 50.0
        assert metrics.db_slowest_query.tables == ("projects", "clients")
        assert metrics.db_slowest_query.source == "app.api.v1.projects:_project_query"
    finally:
        finish_request_metrics(token)

    print("Performance slow-query fingerprint verification passed")


if __name__ == "__main__":
    main()
