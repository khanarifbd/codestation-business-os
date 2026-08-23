import { NextRequest, NextResponse } from "next/server";

import { resolveDeviceId, setAuthCookies, setDeviceIdCookie, type TokenPair } from "@/lib/auth-session";
import { requestContextHeaders } from "@/lib/request-context";
import { backendFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const deviceId = resolveDeviceId(request);
  const upstream = await backendFetch("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...requestContextHeaders(request),
      "X-Business-OS-Device-ID": deviceId,
    },
    body,
  });

  const payload = await upstream.json();
  if (!upstream.ok) {
    return NextResponse.json(payload, { status: upstream.status });
  }

  const tokens = payload as TokenPair;
  const response = NextResponse.json({ user: tokens.user });
  setAuthCookies(response, tokens);
  setDeviceIdCookie(response, deviceId);
  return response;
}
