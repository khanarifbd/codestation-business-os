import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const hasAccessToken = Boolean(request.cookies.get("access_token")?.value);
  const hasRefreshToken = Boolean(request.cookies.get("refresh_token")?.value);

  if (hasAccessToken || hasRefreshToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
