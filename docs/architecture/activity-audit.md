# Activity Audit Contract

Activity logging is a non-negotiable system invariant for CodeStation Business OS.

## Goals

The audit trail must answer:

- who performed an action;
- which tenant/company it affected;
- what action occurred;
- which entity was affected;
- what changed before and after;
- whether the action succeeded or failed;
- when it happened;
- which request/IP/User-Agent produced it when available.

## Append-only storage

`activity_logs` is append-only. PostgreSQL blocks `UPDATE` and `DELETE` using a database trigger. Audit records must never be edited to rewrite history.

If retention or archival is needed later, use a dedicated archival process rather than mutating historical rows.

## Transaction rule

Every ORM create/update/delete must include an `ActivityLog` in the same database transaction.

The SQLAlchemy session audit guard rejects a commit when a business mutation was seen without an audit record. This prevents developers from silently forgetting activity logging in future modules.

Detailed business activity is written with `record_activity(...)` before the transaction commits. If the audit insert fails, the business mutation fails too.

## Tenant and platform scope

Tenant activity includes `organization_id` and is visible only to company admins through tenant-scoped APIs.

Platform activity is visible only to `super_admin` through `/api/v1/platform/activity-logs`.

A platform action affecting a company should still include that company's `organization_id` so the event can be correlated and, where appropriate, surfaced in tenant history.

## Sensitive data

Never store secrets in audit payloads. The centralized audit sanitizer redacts keys containing password, secret, token, JWT, or authorization data.

Do not intentionally pass raw credentials, access tokens, refresh tokens, database passwords, private keys, or authorization headers to audit metadata.

## Request correlation

FastAPI assigns or accepts an `X-Request-ID` for each request and returns it in the response. Next.js BFF routes forward client IP, User-Agent, forwarded IP headers, and request ID to FastAPI when available.

This allows API errors, reverse-proxy logs, and activity records to be correlated.

## Performance

Activity lists return lightweight summaries and use cursor pagination. Heavy `before_data`, `after_data`, IP, User-Agent, and metadata are returned only by detail endpoints.

Indexes cover the primary access patterns:

- `(organization_id, created_at)`
- `(actor_user_id, created_at)`
- `(action, created_at)`
- `(entity_type, entity_id, created_at)`
- `request_id`

## Historical baseline

Audit history cannot truthfully reconstruct actions that happened before audit logging existed. Migration `0005_activity_audit` writes one baseline event containing counts of the existing users, organizations, and subscriptions and explicitly records that earlier historical actions were not reconstructed.

From that migration forward, all new ORM mutations must satisfy the audit guard.

## Event naming

Use stable dot-separated event names, for example:

- `auth.user.created`
- `auth.login.succeeded`
- `auth.login.failed`
- `auth.logout`
- `organization.created`
- `platform.user.status_changed`
- `platform.organization.status_changed`
- `platform.subscription.updated`
- `employee.invited`
- `employee.role_changed`
- `invoice.created`
- `payment.recorded`

New modules must define their audit events as part of the feature implementation, not as a later cleanup task.
