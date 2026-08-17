import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext, method: string) {
  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const contentType = request.headers.get("content-type");
  const body = method === "GET" || method === "DELETE" ? undefined : await request.text();

  const headers: Record<string, string> = {};
  if (body !== undefined && contentType) headers["Content-Type"] = contentType;

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/profile${suffix}`,
    { method, headers, body },
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PATCH");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "POST");
}
