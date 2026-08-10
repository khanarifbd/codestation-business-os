import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

async function proxy(request: NextRequest, method: "GET" | "POST" | "DELETE") {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const accessId = request.nextUrl.searchParams.get("access_id");
  const clientId = request.nextUrl.searchParams.get("client_id");
  const clientIds = request.nextUrl.searchParams.get("client_ids");
  if (method === "DELETE" && !accessId && !clientId) {
    return NextResponse.json({ detail: "access_id or client_id is required" }, { status: 400 });
  }

  let upstreamPath = "/crm/client-access";
  if (method === "GET" && clientIds) {
    upstreamPath = `/crm/client-access/status?client_ids=${encodeURIComponent(clientIds)}`;
  } else if (method === "DELETE" && clientId) {
    upstreamPath = `/crm/client-access/client/${encodeURIComponent(clientId)}`;
  } else if (method === "DELETE" && accessId) {
    upstreamPath = `/crm/client-access/${encodeURIComponent(accessId)}`;
  }

  const body = method === "POST" ? await request.text() : undefined;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    upstreamPath,
    {
      method,
      headers: {
        "X-Organization-ID": organizationId,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body,
    },
  );

  const payload = upstream.status === 204 ? null : await upstream.json();
  const response = payload === null
    ? new NextResponse(null, { status: upstream.status })
    : NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest) {
  return proxy(request, "GET");
}

export async function POST(request: NextRequest) {
  return proxy(request, "POST");
}

export async function DELETE(request: NextRequest) {
  return proxy(request, "DELETE");
}
