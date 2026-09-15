from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from time import perf_counter

PERFORMANCE_PHASE_AUTHENTICATION = "authentication"
PERFORMANCE_PHASE_TENANT_RESOLUTION = "tenant_resolution"
PERFORMANCE_PHASE_PERMISSION = "permission"
SLOW_DB_QUERY_MS = 100.0


@dataclass
class RequestPerformanceMetrics:
    """Mutable request-scoped counters shared with sync DB worker threads.

    Starlette/AnyIO copies context variables into worker threads. Keeping the
    metrics object mutable means SQLAlchemy engine events and synchronous
    FastAPI dependencies can update the same request metrics without logging
    SQL text, bind values, tenant identifiers, or other sensitive business data.
    """

    db_query_count: int = 0
    db_total_ms: float = 0.0
    db_max_query_ms: float = 0.0
    db_slow_query_count: int = 0
    phase_total_ms: dict[str, float] = field(default_factory=dict)
    phase_db_ms: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class RequestPerformanceBreakdown:
    """Non-overlapping request timing buckets used for root-cause attribution."""

    database_ms: float
    authentication_ms: float
    tenant_resolution_ms: float
    permission_ms: float
    application_other_ms: float
    root_cause: str
    root_cause_ms: float
    root_cause_pct: float


_current_metrics: ContextVar[RequestPerformanceMetrics | None] = ContextVar(
    "business_os_request_performance_metrics",
    default=None,
)
_current_phase: ContextVar[str | None] = ContextVar(
    "business_os_request_performance_phase",
    default=None,
)


def start_request_metrics() -> tuple[RequestPerformanceMetrics, Token[RequestPerformanceMetrics | None]]:
    metrics = RequestPerformanceMetrics()
    token = _current_metrics.set(metrics)
    return metrics, token


def finish_request_metrics(token: Token[RequestPerformanceMetrics | None]) -> None:
    _current_metrics.reset(token)


@contextmanager
def track_performance_phase(phase: str) -> Iterator[None]:
    """Measure a synchronous request phase and attribute its DB time separately.

    The phase total includes any SQL executed while the phase is active. The
    breakdown later subtracts that SQL time so database time is never counted
    twice when choosing the dominant root cause.
    """

    metrics = _current_metrics.get()
    if metrics is None:
        yield
        return

    phase_token = _current_phase.set(phase)
    started_at = perf_counter()
    try:
        yield
    finally:
        duration_ms = max(0.0, (perf_counter() - started_at) * 1000)
        metrics.phase_total_ms[phase] = metrics.phase_total_ms.get(phase, 0.0) + duration_ms
        _current_phase.reset(phase_token)


def record_db_query(duration_ms: float) -> None:
    metrics = _current_metrics.get()
    if metrics is None:
        return

    safe_duration_ms = max(0.0, duration_ms)
    metrics.db_query_count += 1
    metrics.db_total_ms += safe_duration_ms
    metrics.db_max_query_ms = max(metrics.db_max_query_ms, safe_duration_ms)
    if safe_duration_ms >= SLOW_DB_QUERY_MS:
        metrics.db_slow_query_count += 1

    phase = _current_phase.get()
    if phase is not None:
        metrics.phase_db_ms[phase] = metrics.phase_db_ms.get(phase, 0.0) + safe_duration_ms


def _phase_non_db_ms(metrics: RequestPerformanceMetrics, phase: str) -> float:
    return max(
        0.0,
        metrics.phase_total_ms.get(phase, 0.0) - metrics.phase_db_ms.get(phase, 0.0),
    )


def build_request_performance_breakdown(
    metrics: RequestPerformanceMetrics,
    total_ms: float,
) -> RequestPerformanceBreakdown:
    """Build additive timing buckets and identify the largest contributor.

    Database time is a first-class bucket. Auth, tenant, and permission buckets
    contain only their non-DB time, while the remaining request time is grouped
    as application_other (endpoint logic, serialization, and other uninstrumented
    work). This keeps the buckets non-overlapping and makes root-cause percentages
    meaningful.
    """

    safe_total_ms = max(0.0, total_ms)
    database_ms = min(safe_total_ms, max(0.0, metrics.db_total_ms))
    remaining_ms = max(0.0, safe_total_ms - database_ms)

    def consume_phase(phase: str) -> float:
        nonlocal remaining_ms
        phase_ms = min(remaining_ms, _phase_non_db_ms(metrics, phase))
        remaining_ms = max(0.0, remaining_ms - phase_ms)
        return phase_ms

    authentication_ms = consume_phase(PERFORMANCE_PHASE_AUTHENTICATION)
    tenant_resolution_ms = consume_phase(PERFORMANCE_PHASE_TENANT_RESOLUTION)
    permission_ms = consume_phase(PERFORMANCE_PHASE_PERMISSION)
    application_other_ms = remaining_ms

    buckets = {
        "database": database_ms,
        "authentication": authentication_ms,
        "tenant_resolution": tenant_resolution_ms,
        "permission": permission_ms,
        "application_other": application_other_ms,
    }
    if safe_total_ms <= 0.0:
        root_cause = "unknown"
        root_cause_ms = 0.0
        root_cause_pct = 0.0
    else:
        root_cause, root_cause_ms = max(buckets.items(), key=lambda item: item[1])
        root_cause_pct = (root_cause_ms / safe_total_ms) * 100.0

    return RequestPerformanceBreakdown(
        database_ms=database_ms,
        authentication_ms=authentication_ms,
        tenant_resolution_ms=tenant_resolution_ms,
        permission_ms=permission_ms,
        application_other_ms=application_other_ms,
        root_cause=root_cause,
        root_cause_ms=root_cause_ms,
        root_cause_pct=root_cause_pct,
    )
