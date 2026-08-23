import { NextRequest, NextResponse } from "next/server";

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
const DEVICE_ID_COOKIE = "business_os_device_id";
const DEVICE_ID_MAX_AGE = 400 * 24 * 60 * 60;
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveDeviceId(request: NextRequest): string {
  const existing = request.cookies.get(DEVICE_ID_COOKIE)?.value?.trim();
  if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
  return crypto.randomUUID();
}

export function setDeviceIdCookie(response: NextResponse, deviceId: string): void {
  response.cookies.set(DEVICE_ID_COOKIE, deviceId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_ID_MAX_AGE,
  });
}

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
