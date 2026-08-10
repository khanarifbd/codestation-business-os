# Tenancy and Platform Access Contract

This document defines non-negotiable architecture rules for CodeStation Business OS.

## Identity and roles

A `User` is a global login identity. Global platform authority lives on `users.system_role`:

- `super_admin` — CodeStation AI platform administration
- `user` — normal SaaS user

Tenant/company authority never lives on `users.system_role`. It lives on `memberships.role`:

- `admin` — company administrator; may manage company users/employees and tenant settings
- `user` — company employee/member

The same user may be an `admin` in one organization and a `user` in another.

## Tenant boundary

`Organization` is the canonical tenant. Do not introduce a second `tenant_id` alongside `organization_id`.

Every organization-owned business table must contain a non-null `organization_id` foreign key. Prefer inheriting `TenantOwnedMixin` so new modules cannot accidentally omit the tenant boundary.

Examples of tenant-owned data:

- leads and clients
- orders and projects
- invoices, payments, expenses, bank accounts
- employees and HR records
- documents and assets
- tenant roles, settings, services, vendors

Global data such as users, countries, currencies, platform plans, and platform feature definitions does not require `organization_id`.

## Request tenant context

Tenant APIs must depend on `CurrentTenant`, which resolves the `X-Organization-ID` request header and verifies:

1. the user is authenticated;
2. an active membership exists for the selected organization;
3. the organization is active.

Company-admin-only APIs must depend on `CurrentTenantAdmin`.

Never trust an organization ID supplied by a request without passing through the tenant dependency.

## Platform administration

Platform APIs live under `/api/v1/platform/*` and depend on `CurrentSuperAdmin`.

A super admin does not silently bypass tenant membership inside normal tenant APIs. Cross-tenant administration uses explicit platform routes, keeping platform authority separate from tenant authority.

## Super admin bootstrap

At API startup, the database is checked for an active `super_admin`. If none exists, the account configured by these environment values is created, promoted, or reactivated:

- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`
- `SUPER_ADMIN_NAME`

Production/staging deployment generates a secure initial password when the value is absent.

## Company lifecycle

Organizations have a platform-controlled lifecycle status:

- `active`
- `suspended`

Suspended organizations cannot enter normal tenant context. Suspending a company does not delete its business data.

## Subscription boundary

Each organization has one current `Subscription` record. Subscription state is independent from the organization lifecycle so billing operations and platform access control remain explicit.

Initial subscription states:

- `trialing`
- `active`
- `past_due`
- `suspended`
- `canceled`

## Database performance rules

Tenant-owned tables must be indexed around actual access patterns. Common patterns should lead with `organization_id`, for example:

- `(organization_id, created_at)`
- `(organization_id, status)`
- `(organization_id, client_id)`

Tenant-scoped business identifiers must use composite uniqueness, for example:

- `UNIQUE (organization_id, invoice_number)`
- `UNIQUE (organization_id, employee_code)`

Use server-side pagination for lists. Avoid unbounded tenant queries, `SELECT *` for list endpoints, and unnecessary heavy joins.

## Security invariant

No tenant-owned record may be read, written, updated, or deleted unless its organization scope has been validated for the current request.
