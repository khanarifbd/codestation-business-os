# Team, Roles and Permissions Contract

## Identity vs employment

`users` is the global login identity. A user may belong to multiple organizations.

`memberships` is the organization access record. Every membership points to an `organization_role` through `role_id`.

`employees` is the tenant-owned HR/operational profile. It points to a membership and stores company-specific fields such as employee code, department, designation, manager, employment type and work contact details.

Do not move employee-specific information onto `users`.

## Roles

Every organization has protected built-in roles:

- `Admin` (`slug=admin`) — permissions `[*]`
- `User` (`slug=user`) — standard employee access

Custom roles are tenant-owned and may contain a subset of the central permission catalog. Examples include HR, Accountant, Sales, Project Manager and Viewer.

`memberships.role` remains as a compatibility slug for built-in admin/user behavior. New authorization must use `memberships.role_id` and `organization_roles.permissions`.

## Permissions

Permission names use `module.action`, for example:

- `employees.view`
- `employees.manage`
- `employees.invite`
- `roles.manage`
- `clients.view`
- `clients.manage`
- `finance.view`
- `finance.manage`

Use `require_tenant_permission("permission.name")` for new tenant APIs that are not strictly admin-only. `*` grants all tenant permissions.

## Invitations

Employee invitations store only a SHA-256 hash of the one-time token. The plaintext token is returned once when the invitation is created and is never persisted.

Invitations expire after seven days. New users create a password when accepting. Existing users must prove possession of their existing Business OS password before the membership is linked.

Email delivery is intentionally separate from the invitation domain model. The current UI exposes a copyable invite link; a transactional email provider can send the same link later without changing the database model.

## Employee numbering

Employee codes use the tenant's `employee` document sequence. Sequence allocation uses a PostgreSQL row lock so concurrent invitations cannot receive the same automatically generated sequence number.

## Admin safety

The system must never allow a company to lose its final active Admin membership. Employee role/status changes enforce this invariant.

## Audit

Team mutations must write an ActivityLog in the same transaction. Key actions include:

- `employee.invited`
- `employee.invitation.accepted`
- `employee.invitation.revoked`
- `employee.updated`
- `department.created`
- `department.updated`
- `designation.created`
- `designation.updated`
- `role.created`
- `role.updated`

The global ORM audit guard remains the final safety net if a future endpoint forgets to record its mutation.
