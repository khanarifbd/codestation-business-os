// URL intent selects no data until the current tenant's authorized setup is loaded.
// Repeated keys and non-UUID values are not actionable create requests.
export function parseInvoiceClientIntent(value: string | string[] | undefined): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase() : null;
}
