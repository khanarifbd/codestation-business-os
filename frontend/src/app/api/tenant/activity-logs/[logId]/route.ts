import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ logId: string }> },
) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const { logId } = await context.params;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/tenant/activity-logs/${encodeURIComponent(logId)}`,
    { headers: { "X-Organization-ID": organizationId } },
  );
  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
