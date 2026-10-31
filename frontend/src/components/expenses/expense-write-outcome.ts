/** Only a readable application rejection proves a fresh write failed. A timeout,
 * conflict or unparseable response can follow a committed write; never replace
 * its retained operation or replay an unkeyed mutation on that evidence. */
export function isDefiniteExpenseRejection(status: number, payload: unknown): boolean {
  if (status < 400 || status >= 500 || status === 408 || status === 409) return false;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  const message = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as { msg?: unknown; message?: unknown };
    return text(item.msg) || text(item.message);
  };
  const source = payload as { detail?: unknown; message?: unknown };
  // The finance proxy preserves HTTP status when JSON parsing fails. Its
  // synthetic detail is not evidence of an application-level rejection.
  if (source.detail === "Unexpected upstream response") return false;
  return text(source.detail) || message(source.detail)
    || Array.isArray(source.detail) && source.detail.some(item => text(item) || message(item))
    || text(source.message);
}
