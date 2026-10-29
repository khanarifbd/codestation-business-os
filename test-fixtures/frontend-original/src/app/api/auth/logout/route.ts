import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function POST(request: NextRequest) {
  const { upstream } = await authenticatedBackendFetch(request, "/auth/logout", {
    method: "POST",
  });

  if (!upstream.ok && upstream.status !== 401) {
    const payload = await upstream.json().catch(() => ({ detail: "Unable to sign out" }));
    return NextResponse.json(payload, { status: upstream.status });
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
