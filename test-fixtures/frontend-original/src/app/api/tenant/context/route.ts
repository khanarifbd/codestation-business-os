import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function GET(request: NextRequest) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, "/tenant/context", {
    headers: { "X-Organization-ID": organizationId },
  });

  const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
