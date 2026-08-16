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
  const query = method === "GET" ? request.nextUrl.search : "";
  const body = method === "GET" || method === "DELETE" ? undefined : await request.text();

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/crm${suffix}${query}`,
    {
      method,
      headers: {
        "X-Organization-ID": organizationId,
        ...(body ? { "Content-Type": request.headers.get("content-type") ?? "application/json" } : {}),
      },
      body,
    },
  );

  if (upstream.status === 204) {
    const response = new NextResponse(null, { status: 204 });
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

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PUT");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PATCH");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "DELETE");
}
