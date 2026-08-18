import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext, method: string) {
  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const contentType = request.headers.get("content-type");
  const body = method === "GET" || method === "DELETE" ? undefined : await request.arrayBuffer();

  const headers: Record<string, string> = {};
  if (body !== undefined && contentType) headers["Content-Type"] = contentType;

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/profile${suffix}`,
    { method, headers, body },
  );

  if (upstream.status === 204) {
    const response = new NextResponse(null, { status: 204 });
    if (suffix === "/password" && method === "POST") {
      // The backend increments auth_token_version when an existing password is
      // replaced. Clear the now-revoked browser cookies immediately instead of
      // leaving the current tab holding credentials that will fail on the next API call.
      clearAuthCookies(response);
      response.headers.set("X-Auth-Session-Revoked", "1");
    } else if (rotatedTokens) {
      setAuthCookies(response, rotatedTokens);
    }
    return response;
  }

  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  let response: NextResponse;
  if (upstreamContentType.includes("application/json")) {
    const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
    response = NextResponse.json(payload, { status: upstream.status });
  } else {
    const responseHeaders = new Headers();
    if (upstreamContentType) responseHeaders.set("Content-Type", upstreamContentType);
    for (const name of ["cache-control", "content-length", "content-disposition", "etag", "last-modified", "x-content-type-options"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    response = new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "GET");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PATCH");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "POST");
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PUT");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "DELETE");
}
