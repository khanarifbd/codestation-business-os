import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ logId: string }> },
) {
  const { logId } = await context.params;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/platform/activity-logs/${encodeURIComponent(logId)}`,
  );
  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
