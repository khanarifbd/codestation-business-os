/** Body evidence only: callers retain their existing HTTP/status and retry rules.
 * An absent or malformed error is not evidence that a financial write failed.
 */
const meaningful = (value: unknown): value is string => typeof value === "string"
  && value.trim().length > 0
  && !["null", "undefined", "[object object]", "unexpected upstream response"].includes(value.trim().toLowerCase());
const record = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === "object" && !Array.isArray(value);

export function hasAccountingRejectionDetail(payload: unknown): boolean {
  if (!record(payload)) return false;
  if (meaningful(payload.detail)) return true;
  return Array.isArray(payload.detail) && payload.detail.length > 0
    && payload.detail.every(item => record(item)
      && meaningful(item.msg) && meaningful(item.type)
      && Array.isArray(item.loc) && item.loc.length > 0
      && item.loc.every(part => meaningful(part)
        || typeof part === "number" && Number.isSafeInteger(part) && part >= 0));
}
