import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, setAuthCookies, type TokenPair } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function POST(request: NextRequest) {
  const { upstream } = await authenticatedBackendFetch(request, "/auth/session/activity", { method: "POST" });
  if (!upstream.ok) {
    const response = NextResponse.json(
      await upstream.json().catch(() => ({ detail: "Unable to update session activity." })),
      { status: upstream.status },
    );
    if (upstream.status === 401) clearAuthCookies(response);
    return response;
  }
  const tokens = (await upstream.json()) as TokenPair;
  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, tokens);
  return response;
}
