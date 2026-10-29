import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, `/reports${suffix}${request.nextUrl.search}`, {
    method: "GET",
    headers: { "X-Organization-ID": organizationId },
  });
  const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) { return proxy(request, context); }
