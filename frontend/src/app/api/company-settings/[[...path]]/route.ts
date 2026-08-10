import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext, method: string) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const requestContentType = request.headers.get("content-type");
  let body: BodyInit | undefined;

  if (method !== "GET" && method !== "DELETE") {
    body = requestContentType?.includes("multipart/form-data")
      ? await request.arrayBuffer()
      : await request.text();
  }

  const headers: Record<string, string> = {
    "X-Organization-ID": organizationId,
  };
  if (body !== undefined && requestContentType) {
    headers["Content-Type"] = requestContentType;
  }

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/company-settings${suffix}`,
    { method, headers, body },
  );

  if (upstream.status === 204) {
    const response = new NextResponse(null, { status: 204 });
    if (rotatedTokens) setAuthCookies(response, rotatedTokens);
    return response;
  }

  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  if (!upstreamContentType.includes("application/json")) {
    const responseHeaders = new Headers();
    if (upstreamContentType) responseHeaders.set("Content-Type", upstreamContentType);
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) responseHeaders.set("Content-Disposition", disposition);
    const length = upstream.headers.get("content-length");
    if (length) responseHeaders.set("Content-Length", length);

    const response = new NextResponse(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
    if (rotatedTokens) setAuthCookies(response, rotatedTokens);
    return response;
  }

  const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "POST");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PATCH");
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PUT");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "DELETE");
}