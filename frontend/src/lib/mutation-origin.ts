import { NextResponse } from "next/server";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Guard the incoming browser BFF mutation, not internal backend/refresh calls.
 *
 * Standalone Next can use an internal hostname in request.url behind ingress.
 * Production therefore requires the existing server-only PUBLIC_APP_URL as its
 * canonical HTTPS origin. Local/test uses the actual request URL. Forwarded host,
 * Referer and caller-supplied allowlists are deliberately not trusted.
 * Nonbrowser BFF clients must supply Origin; direct Bearer backend APIs are unchanged.
 */
export function guardMutationOrigin(
  request: Request,
  options: { requireJson?: boolean } = {},
): NextResponse | null {
  if (READ_METHODS.has(request.method.toUpperCase())) return null;

  let expectedOrigin: string | null;
  if (process.env.NODE_ENV === "production") {
    expectedOrigin = httpOrigin(process.env.PUBLIC_APP_URL?.trim() ?? "");
    if (!expectedOrigin?.startsWith("https://")) {
      return NextResponse.json(
        { detail: "Browser mutation origin is not configured for this deployment." },
        { status: 503 },
      );
    }
  } else {
    try {
      expectedOrigin = new URL(request.url).origin;
    } catch {
      expectedOrigin = null;
    }
  }

  const origin = httpOrigin(request.headers.get("origin") ?? "");
  if (
    !expectedOrigin || !origin || origin !== expectedOrigin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return NextResponse.json(
      { detail: "A same-origin request is required for this action." },
      { status: 403 },
    );
  }

  if (options.requireJson) {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return NextResponse.json(
        { detail: "This action requires an application/json request." },
        { status: 415 },
      );
    }
  }
  return null;
}
