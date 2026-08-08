import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ expenseId: string; path?: string[] }> };

async function proxy(request: NextRequest, context: RouteContext, method: "GET" | "POST" | "DELETE") {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });

  const { expenseId, path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const headers: Record<string, string> = { "X-Organization-ID": organizationId };
  let body: ArrayBuffer | undefined;
  if (method === "POST") {
    body = await request.arrayBuffer();
    const contentType = request.headers.get("content-type");
    if (contentType) headers["Content-Type"] = contentType;
  }

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/finance/expenses/${expenseId}/documents${suffix}`,
    { method, headers, body },
  );

  const contentType = upstream.headers.get("content-type") ?? "";
  let response: NextResponse;
  if (upstream.status === 204) {
    response = new NextResponse(null, { status: 204 });
  } else if (contentType.includes("application/json")) {
    const text = await upstream.text();
    response = new NextResponse(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
  } else {
    const passthrough = new Headers();
    for (const name of ["content-type", "content-disposition", "cache-control", "x-content-type-options"]) {
      const value = upstream.headers.get(name);
      if (value) passthrough.set(name, value);
    }
    response = new NextResponse(upstream.body, { status: upstream.status, headers: passthrough });
  }
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) { return proxy(request, context, "GET"); }
export async function POST(request: NextRequest, context: RouteContext) { return proxy(request, context, "POST"); }
export async function DELETE(request: NextRequest, context: RouteContext) { return proxy(request, context, "DELETE"); }
