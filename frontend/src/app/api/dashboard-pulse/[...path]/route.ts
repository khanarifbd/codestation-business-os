import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: Context) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });

  const { path } = await context.params;
  const suffix = path.join("/");
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/dashboard-pulse/${suffix}${request.nextUrl.search}`,
    {
      method: "GET",
      headers: { "X-Organization-ID": organizationId },
    },
  );

  const payload = await upstream.json().catch(() => null);
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
