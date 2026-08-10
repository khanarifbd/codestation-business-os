# Company Master Settings Contract

Company setup is a tenant-owned foundation used by CRM, HR, projects, quotations, orders, invoices, payments, reports, tax, and documents.

## Core organization remains lightweight

`organizations` stays focused on frequently accessed tenant context:

- id / tenant id
- display name and slug
- lifecycle status
- country, timezone, base currency
- business type and team size
- financial year start month
- created-by and timestamps

Do not move platform-controlled fields such as subscription status into company-editable settings.

## International company profile

`organization_profiles` stores legal and contact information:

- legal name and trading / DBA name
- industry and company size
- incorporation / founded date
- website and company description
- primary, billing, and support email
- phone, alternate phone, WhatsApp, fax
- internal notes

## Country-specific registration and tax identifiers

`organization_identifiers` is intentionally flexible. Do not add one database column per country identifier.

Examples that may be represented as rows:

- company registration number
- Bangladesh TIN / BIN
- US EIN
- Australia ABN / ACN
- VAT / GST registration
- DUNS
- any future custom identifier

Each identifier stores type, display label, value, country, issuing authority, issue/expiry dates, and primary flag.

## Addresses

`organization_addresses` supports one record per address type:

- registered
- office
- billing
- mailing

Address fields use international-neutral names: line1, line2, city, state/province/region, postal/ZIP code, and ISO country code.

## Localization

`organization_localization_settings` stores display preferences while `organizations` retains the canonical country/timezone/currency tenant context.

Settings include language, date/time formats, number format, decimal places, currency position, and first day of week.

## Finance and tax defaults

`organization_financial_settings` stores:

- accounting currency
- default payment terms
- inclusive/exclusive tax calculation
- default tax rate
- whether prices include tax

The financial year start month remains on the core organization because reporting uses it frequently.

## Document numbering

`organization_document_sequences` owns tenant-scoped numbering for:

- invoices
- quotations
- orders
- projects
- clients
- employees

Each sequence has a prefix, next number, padding, and separator. Future document creation must update sequence numbers transactionally.

## Branding

`organization_branding` stores URLs/storage references for company, square, and invoice logos plus document colors and footer text.

Binary files should live in object storage, not PostgreSQL. Database records store durable object keys/URLs.

## Company documents

`organization_documents` stores metadata for registration certificates, trade licences, tax certificates, and custom company documents, including issue/expiry dates and object-storage references.

## Online and legal links

`organization_online_profiles` stores privacy policy, terms, LinkedIn, Facebook, X, Instagram, and YouTube URLs.

## System defaults

`organization_system_defaults` provides reusable starting values for future modules:

- default client country and currency
- default document language
- default lead status
- default project status
- default order status
- default invoice status
- quotation validity days

These are defaults, not replacements for future tenant-configurable status catalogs.

## Permissions

Company master settings APIs require `CurrentTenantAdmin`. A normal company member cannot modify company-wide settings.

A platform `super_admin` does not silently bypass this tenant permission. Platform-only controls remain under explicit `/platform/*` APIs.

## Audit invariant

Every company settings mutation must write an `ActivityLog` in the same PostgreSQL transaction. The global ORM audit guard rejects business commits that omit activity logging.

Typical actions:

- `company.core.updated`
- `company.profile.updated`
- `company.identifier.created/deleted`
- `company.address.updated`
- `company.localization.updated`
- `company.financial.updated`
- `company.numbering.updated`
- `company.branding.updated`
- `company.online_legal.updated`
- `company.document.created/deleted`
- `company.system_defaults.updated`

## Performance

One-to-one settings tables are separated from `organizations` so login and tenant-context queries do not load infrequently used legal/branding/document data.

Settings are loaded only on company administration screens. Business modules should select only the settings they actually need.
