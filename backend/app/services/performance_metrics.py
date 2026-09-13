from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass


@dataclass
class RequestPerformanceMetrics:
    """Mutable request-scoped counters shared with sync DB worker threads.

    Starlette/AnyIO copies context variables into worker threads. Keeping the
    metrics object mutable means SQLAlchemy engine events can update the same
    object without logging SQL text, bind values, tenant identifiers, or other
    sensitive business data.
    """

    db_query_count: int = 0
    db_total_ms: float = 0.0


_current_metrics: ContextVar[RequestPerformanceMetrics | None] = ContextVar(
    "business_os_request_performance_metrics",
    default=None,
)


def start_request_metrics() -> tuple[RequestPerformanceMetrics, Token[RequestPerformanceMetrics | None]]:
    metrics = RequestPerformanceMetrics()
    token = _current_metrics.set(metrics)
    return metrics, token


def finish_request_metrics(token: Token[RequestPerformanceMetrics | None]) -> None:
    _current_metrics.reset(token)


def record_db_query(duration_ms: float) -> None:
    metrics = _current_metrics.get()
    if metrics is None:
        return
    metrics.db_query_count += 1
    metrics.db_total_ms += max(0.0, duration_ms)
