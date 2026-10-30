/** Body evidence only. Each operation retains its own allowed HTTP statuses. */
export function verifiedHRRejectionBody(body: unknown, allowValidationIssues = false): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const detail = (body as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail.trim().length > 0;
  return allowValidationIssues && Array.isArray(detail) && detail.length > 0 && detail.every(issue =>
    issue && typeof issue === "object" && !Array.isArray(issue) &&
    Array.isArray(issue.loc) && issue.loc.length > 0 && issue.loc.every((part: unknown) => typeof part === "string" || typeof part === "number" && Number.isFinite(part)) &&
    typeof issue.msg === "string" && issue.msg.trim().length > 0 &&
    typeof issue.type === "string" && issue.type.trim().length > 0);
}
