import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies, type TokenPair } from "@/lib/auth-session";
import { backendFetch } from "@/lib/server-api";

const secure = process.env.NODE_ENV === "production";

async function refreshSession(request: NextRequest): Promise<TokenPair | null> {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) return null;

  const response = await backendFetch("/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) return null;
  return (await response.json()) as TokenPair;
}

async function proxyOrganizations(request: NextRequest, method: "GET" | "POST") {
  let accessToken = request.cookies.get("access_token")?.value;
  let rotatedTokens: TokenPair | null = null;

  if (!accessToken) {
    rotatedTokens = await refreshSession(request);
    accessToken = rotatedTokens?.access_token;
  }

  if (!accessToken) {
    return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
  }

  const body = method === "POST" ? await request.text() : undefined;
  let upstream = await backendFetch("/organizations", {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

  if (upstream.status === 401 && !rotatedTokens) {
    rotatedTokens = await refreshSession(request);
    if (rotatedTokens) {
      upstream = await backendFetch("/organizations", {
        method,
        headers: {
          Authorization: `Bearer ${rotatedTokens.access_token}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body,
      });
    }
  }

  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);

  if (method === "POST" && upstream.ok && payload?.organization?.id) {
    response.cookies.set("organization_id", payload.organization.id, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  return response;
}

export async function GET(request: NextRequest) {
  return proxyOrganizations(request, "GET");
}

export async function POST(request: NextRequest) {
  return proxyOrganizations(request, "POST");
}
