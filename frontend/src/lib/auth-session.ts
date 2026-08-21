import { NextResponse } from "next/server";

export type AuthUser = {
  id: string;
  email: string;
  username?: string | null;
  full_name: string;
  system_role: "super_admin" | "user" | string;
  is_active: boolean;
  is_verified: boolean;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: AuthUser;
};

const secure = process.env.NODE_ENV === "production";

export function setAuthCookies(response: NextResponse, tokens: TokenPair): void {
  response.cookies.set("access_token", tokens.access_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
  response.cookies.set("refresh_token", tokens.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set("access_token", "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("refresh_token", "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("organization_id", "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
