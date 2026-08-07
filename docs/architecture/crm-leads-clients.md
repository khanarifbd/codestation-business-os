# CRM — Leads and Clients Architecture Contract

## Scope

CRM Phase 1 owns lead capture, qualification, follow-up history, configurable pipeline metadata, and conversion into durable client master records.

## Tenant boundary

Every CRM business table is organization-owned and contains `organization_id`.

Tenant-owned tables:

- `lead_statuses`
- `lead_sources`
- `leads`
- `lead_interactions`
- `clients`

No CRM query may read or mutate a record without the current organization boundary.

## Lead vs client

A Lead is a potential business relationship. A Client is a durable business master record used by downstream modules such as quotation, order, project, invoice and payment.

A lead conversion:

1. locks the lead row
2. rejects a second conversion
3. obtains the next tenant-scoped client number
4. creates the client
5. links `lead.converted_client_id`
6. records `converted_at`
7. moves the lead to the first active `won` pipeline status when available
8. writes a CRM timeline event
9. writes the immutable Activity Log event
10. commits all changes in one PostgreSQL transaction

If any step fails, the transaction rolls back.

## Numbering

Lead and client numbers use `organization_document_sequences`.

- Lead default prefix: `LEAD`
- Client default prefix: `CLI`

Sequence rows are selected `FOR UPDATE` before incrementing. Concurrent creates therefore cannot issue the same tenant document number.

## Pipeline configuration

Each organization has its own statuses and sources.

Default statuses:

- New
- Contacted
- Qualified
- Proposal
- Won
- Lost

Default sources:

- Website
- Referral
- Fiverr
- Upwork
- LinkedIn
- Facebook
- Email
- Phone
- Other

Company admins may add, rename, order, enable or disable pipeline metadata without a schema migration.

`organization_system_defaults.default_lead_status` is interpreted as a status slug. Lead creation resolves that configured slug first, then the status marked `is_default`, then the first active status by sort order.

## Audit Log vs CRM Timeline

These must remain separate.

### Activity Log

Immutable security/business audit trail. It records who changed business state, before/after state, request metadata and timestamp. CRM mutation commits are blocked by the global audit guard if no Activity Log is staged.

Examples:

- `crm.lead.created`
- `crm.lead.updated`
- `crm.lead.interaction_created`
- `crm.lead.converted`
- `crm.client.created`
- `crm.client.updated`
- `crm.lead_status.created`
- `crm.lead_status.updated`
- `crm.lead_source.created`
- `crm.lead_source.updated`

### Lead interaction timeline

Operational sales history visible to CRM users. It stores notes, calls, emails, meetings and follow-ups. It is not a substitute for the immutable Activity Log.

## Permissions

CRM endpoints use organization role permissions.

- `crm.view`
- `crm.manage`
- `clients.view`
- `clients.manage`

The built-in organization Admin role has wildcard permission. Custom roles can receive only the permissions required for their responsibilities.

## Performance

Lead and client list endpoints use cursor pagination ordered by `(created_at DESC, id DESC)`.

Lists must not include the full interaction timeline. Lead detail loads the timeline only when opened.

Important tenant indexes cover:

- lead status + created time
- lead assignee + created time
- lead follow-up time
- lead email
- client status + created time
- client display name
- client email
- interaction lead + created time

Search/filter endpoints always preserve the organization predicate.

## Future modules

The following modules should reference `clients.id`, not duplicate client identity data:

- quotations
- orders
- projects
- invoices
- payments
- support/customer service

Lead data remains historical after conversion. A client may evolve independently after conversion without rewriting the original lead history.
