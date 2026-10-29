"""Transaction-scoped accounting-period coordination for adopted callers only.

This foundation is not a global close-versus-post guarantee: all financial writers
must adopt the gate-first protocol before that claim is possible. PostgreSQL
concurrency verification is separate from the offline contract tests.

Callers establish their transaction explicitly (or through existing tenant reads)
and acquire before business locks/writes. Helpers never begin, commit, roll back,
upgrade a shared lock, or silently acquire missing ownership during validation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import hashlib

from fastapi import HTTPException
from sqlalchemy import select, text

from app.models.finance_controls import AccountingPeriod


_NAMESPACE = "business-os:period-create:v1:"
_STATE_KEY = "business_os.accounting_period_gate.v1"


class AccountingPeriodGateError(RuntimeError):
    """An internal transaction/protocol/configuration prerequisite is not met."""


@dataclass(frozen=True)
class _Ownership:
    transaction: object
    connection: object
    connection_transaction: object
    organization_id: str
    exclusive: bool


def accounting_period_gate_key(organization_id: str) -> int:
    """Preserve the existing period-creation namespace and signed 64-bit key."""
    if not isinstance(organization_id, str) or not organization_id:
        raise AccountingPeriodGateError("Accounting period gate requires a tenant identifier")
    return int.from_bytes(
        hashlib.sha256((_NAMESPACE + organization_id).encode()).digest()[:8],
        "big", signed=True,
    )


def _active_root(db):
    transaction = db.get_transaction()
    if transaction is None or not transaction.is_active or not db.is_active:
        raise AccountingPeriodGateError("Accounting period gate requires an active root transaction")
    return transaction


def _active_connection(db):
    _active_root(db)  # Session.connection() must never autobegin on our behalf.
    connection = db.connection()
    if connection.closed or connection.invalidated:
        raise AccountingPeriodGateError("Accounting period gate requires a valid transaction connection")
    transaction = connection.get_transaction()
    if transaction is None or not transaction.is_active:
        raise AccountingPeriodGateError("Accounting period gate requires an active connection transaction")
    return connection, transaction


def _require_non_autocommit(connection) -> None:
    # get_isolation_level() intentionally does NOT report DBAPI AUTOCOMMIT.
    # These are documented SQLAlchemy/psycopg attributes, not private internals.
    driver = getattr(getattr(connection, "connection", None), "driver_connection", None)
    if getattr(driver, "autocommit", None) is not False:
        raise AccountingPeriodGateError(
            "Accounting period gate requires a supported driver with autocommit disabled"
        )


def _existing_ownership(db, transaction):
    ownership = db.info.get(_STATE_KEY)
    if ownership is None:
        return None
    if not isinstance(ownership, _Ownership):
        raise AccountingPeriodGateError("Accounting period gate ownership state is invalid")
    if ownership.transaction is not transaction:
        # A reused Session is not evidence that its previous transaction lock lives.
        db.info.pop(_STATE_KEY, None)
        return None
    connection, connection_transaction = _active_connection(db)
    if connection is not ownership.connection or connection_transaction is not ownership.connection_transaction:
        raise AccountingPeriodGateError("Accounting period gate transaction connection changed")
    _require_non_autocommit(connection)
    return ownership


def _require_compatible(ownership, organization_id: str, exclusive: bool) -> None:
    if ownership.organization_id != organization_id:
        raise AccountingPeriodGateError("Accounting period gate permits only one tenant per transaction")
    if exclusive and not ownership.exclusive:
        raise AccountingPeriodGateError(
            "Accounting period gate cannot upgrade shared ownership; start an exclusive transaction"
        )


def acquire_accounting_period_gate(db, organization_id: str, *, exclusive: bool = False) -> None:
    """Acquire once in the current root transaction; exclusive satisfies shared.

    Fresh acquisition inside a savepoint is forbidden: rollback of that savepoint
    could release the PostgreSQL lock while leaving the root transaction alive.
    Reentry inside a savepoint is safe only for ownership acquired in its root.
    The transaction owner retains responsibility for rollback after any failure.
    """
    key = accounting_period_gate_key(organization_id)
    if type(exclusive) is not bool:
        raise AccountingPeriodGateError("Accounting period gate mode must be a boolean")
    transaction = _active_root(db)
    ownership = _existing_ownership(db, transaction)
    if ownership is not None:
        _require_compatible(ownership, organization_id, exclusive)
        return
    if db.get_nested_transaction() is not None:
        raise AccountingPeriodGateError("Acquire the accounting period gate before entering a savepoint")

    connection, connection_transaction = _active_connection(db)
    if connection.dialect.name != "postgresql":
        raise AccountingPeriodGateError("Accounting period gate requires PostgreSQL")
    _require_non_autocommit(connection)
    if connection.get_isolation_level() != "READ COMMITTED":
        raise AccountingPeriodGateError("Accounting period gate requires READ COMMITTED isolation")
    # Isolation inspection must not have changed ownership or introduced a savepoint.
    if _active_root(db) is not transaction or db.get_nested_transaction() is not None:
        raise AccountingPeriodGateError("Accounting period gate transaction changed before acquisition")

    statement = "SELECT pg_advisory_xact_lock(:lock_key)" if exclusive else "SELECT pg_advisory_xact_lock_shared(:lock_key)"
    db.execute(text(statement), {"lock_key": key})

    # An exception or changed transaction can never grant cached ownership.
    current_connection, current_connection_transaction = _active_connection(db)
    if (
        _active_root(db) is not transaction
        or db.get_nested_transaction() is not None
        or current_connection is not connection
        or current_connection_transaction is not connection_transaction
    ):
        raise AccountingPeriodGateError("Accounting period gate transaction changed during acquisition")
    _require_non_autocommit(current_connection)
    db.info[_STATE_KEY] = _Ownership(transaction, connection, connection_transaction, organization_id, exclusive)


def require_accounting_period_gate(db, organization_id: str, *, exclusive: bool = False) -> None:
    """Assert existing transaction ownership; never acquire a missing gate."""
    accounting_period_gate_key(organization_id)
    if type(exclusive) is not bool:
        raise AccountingPeriodGateError("Accounting period gate mode must be a boolean")
    ownership = _existing_ownership(db, _active_root(db))
    if ownership is None:
        raise AccountingPeriodGateError("Accounting period gate must be acquired before financial validation")
    _require_compatible(ownership, organization_id, exclusive)


def ensure_accounting_period_open(
    db, organization_id: str, entry_date: date, *, detail: str | None = None,
) -> None:
    """Validate a new effect's date under an already-held shared/exclusive gate.

    An absent AccountingPeriod remains allowed. Callers decide which new effects
    need validation; this must not reject a replay solely for its historical date.
    """
    require_accounting_period_gate(db, organization_id)
    closed = db.scalar(
        select(AccountingPeriod.id).where(
            AccountingPeriod.organization_id == organization_id,
            AccountingPeriod.status == "closed",
            AccountingPeriod.start_date <= entry_date,
            AccountingPeriod.end_date >= entry_date,
        )
    )
    if closed is not None:
        raise HTTPException(
            status_code=409,
            detail=detail if detail is not None else f"Accounting period is closed for {entry_date.isoformat()}",
        )
