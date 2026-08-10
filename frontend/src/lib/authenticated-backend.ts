import { NextRequest } from "next/server";

import type { TokenPair } from "@/lib/auth-session";
import { requestContextHeaders } from "@/lib/request-context";
import { backendFetch } from "@/lib/server-api";

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

export async function authenticatedBackendFetch(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
): Promise<{ upstream: Response; rotatedTokens: TokenPair | null }> {
  let accessToken = request.cookies.get("access_token")?.value;
  let rotatedTokens: TokenPair | null = null;

  if (!accessToken) {
    rotatedTokens = await refreshSession(request);
    accessToken = rotatedTokens?.access_token;
  }

  if (!accessToken) {
    return {
      upstream: new Response(JSON.stringify({ detail: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      rotatedTokens: null,
    };
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  for (const [name, value] of Object.entries(requestContextHeaders(request))) {
    headers.set(name, value);
  }

  let upstream = await backendFetch(path, { ...init, headers });

  if (upstream.status === 401 && !rotatedTokens) {
    rotatedTokens = await refreshSession(request);
    if (rotatedTokens) {
      headers.set("Authorization", `Bearer ${rotatedTokens.access_token}`);
      upstream = await backendFetch(path, { ...init, headers });
    }
  }

  return { upstream, rotatedTokens };
}
