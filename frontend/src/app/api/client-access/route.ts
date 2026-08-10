import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

async function proxy(request: NextRequest, method: "GET" | "POST" | "DELETE") {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const accessId = request.nextUrl.searchParams.get("access_id");
  if (method === "DELETE" && !accessId) {
    return NextResponse.json({ detail: "access_id is required" }, { status: 400 });
  }

  const body = method === "POST" ? await request.text() : undefined;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    method === "DELETE" ? `/crm/client-access/${encodeURIComponent(accessId!)}` : "/crm/client-access",
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
