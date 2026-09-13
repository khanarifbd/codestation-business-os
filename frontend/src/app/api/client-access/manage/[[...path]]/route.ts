import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext, method: "GET" | "POST" | "DELETE") {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.map(encodeURIComponent).join("/")}` : "";
  const body = method === "POST" ? await request.text() : undefined;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, `/crm/client-access${suffix}`, {
    method,
    headers: {
      "X-Organization-ID": organizationId,
      ...(body ? { "Content-Type": request.headers.get("content-type") ?? "application/json" } : {}),
    },
    body,
  });
  const payload = upstream.status === 204 ? null : await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  const response = payload === null ? new NextResponse(null, { status: upstream.status }) : NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) { return proxy(request, context, "GET"); }
export async function POST(request: NextRequest, context: RouteContext) { return proxy(request, context, "POST"); }
export async function DELETE(request: NextRequest, context: RouteContext) { return proxy(request, context, "DELETE"); }
