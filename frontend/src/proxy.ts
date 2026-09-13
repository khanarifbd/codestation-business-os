import { NextRequest, NextResponse } from "next/server";

import { clearAuthCookies, setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function proxy(request: NextRequest) {
  const hasAccessToken = Boolean(request.cookies.get("access_token")?.value);
  const hasRefreshToken = Boolean(request.cookies.get("refresh_token")?.value);

  if (!hasAccessToken && !hasRefreshToken) {
    return NextResponse.next();
  }

  try {
    const { upstream, rotatedTokens } = await authenticatedBackendFetch(
      request,
      "/profile",
      { method: "GET" },
    );

    if (upstream.ok) {
      const response = NextResponse.redirect(new URL("/dashboard", request.url));
      if (rotatedTokens) setAuthCookies(response, rotatedTokens);
      return response;
    }

    const response = NextResponse.next();
    if (upstream.status === 401) clearAuthCookies(response);
    return response;
  } catch {
    // Do not turn a temporary backend outage into a broken public homepage or
    // clear a potentially valid user session. The protected app APIs remain the
    // source of truth for authorization when the backend becomes available.
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/"],
};
