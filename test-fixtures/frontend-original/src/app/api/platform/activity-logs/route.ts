import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.toString();
  const path = `/platform/activity-logs${query ? `?${query}` : ""}`;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, path);
  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
