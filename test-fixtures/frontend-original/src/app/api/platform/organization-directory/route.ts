import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const query = url.searchParams.toString();
  const path = `/platform/organization-directory${query ? `?${query}` : ""}`;
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, path);
  const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
