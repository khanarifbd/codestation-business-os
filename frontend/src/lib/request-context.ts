export function requestContextHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of [
    "x-business-os-client-ip",
    "x-forwarded-for",
    "x-real-ip",
    "user-agent",
    "x-request-id",
  ]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}
