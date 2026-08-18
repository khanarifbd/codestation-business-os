import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies, type TokenPair } from "@/lib/auth-session";
import { requestContextHeaders } from "@/lib/request-context";
import { backendFetch } from "@/lib/server-api";

const secure = process.env.NODE_ENV === "production";

async function refreshSession(request: NextRequest): Promise<TokenPair | null> {
  const refreshToken = request.cookies.get("refresh_token")?.value;
  if (!refreshToken) return null;

  const response = await backendFetch("/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...requestContextHeaders(request),
    },
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
  const contextHeaders = requestContextHeaders(request);
  let upstream = await backendFetch("/organizations", {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...contextHeaders,
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
          ...contextHeaders,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body,
      });
    }
  }

  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);

  const existingOrganizationId = request.cookies.get("organization_id")?.value;
  let organizationId: string | undefined;

  if (method === "POST") {
    organizationId = payload?.organization?.id;
  } else if (Array.isArray(payload)) {
    const activeMemberships = payload.filter(
      (item) => item?.organization?.status === "active" && item?.status === "active",
    );
    const existingIsValid = Boolean(
      existingOrganizationId
      && activeMemberships.some((item) => item?.organization?.id === existingOrganizationId),
    );
    organizationId = existingIsValid
      ? existingOrganizationId
      : activeMemberships[0]?.organization?.id ?? payload[0]?.organization?.id;
  }

  if (upstream.ok && organizationId && organizationId !== existingOrganizationId) {
    response.cookies.set("organization_id", organizationId, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  } else if (upstream.ok && method === "GET" && !organizationId && existingOrganizationId) {
    response.cookies.set("organization_id", "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
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
