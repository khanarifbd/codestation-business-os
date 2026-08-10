import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies, type TokenPair } from "@/lib/auth-session";
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

export async function proxyTenantRequest(request: NextRequest, upstreamPath: string) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "Select a company workspace first" }, { status: 400 });
  }

  let accessToken = request.cookies.get("access_token")?.value;
  let rotatedTokens: TokenPair | null = null;
  if (!accessToken) {
    rotatedTokens = await refreshSession(request);
    accessToken = rotatedTokens?.access_token;
  }
  if (!accessToken) {
    return NextResponse.json({ detail: "Authentication required" }, { status: 401 });
  }

  const method = request.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const contentType = request.headers.get("content-type");
  const contextHeaders = requestContextHeaders(request);

  const makeRequest = (token: string) => backendFetch(upstreamPath, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Organization-ID": organizationId,
      ...contextHeaders,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body: body && body.byteLength ? body : undefined,
  });

  let upstream = await makeRequest(accessToken);
  if (upstream.status === 401 && !rotatedTokens) {
    rotatedTokens = await refreshSession(request);
    if (rotatedTokens) upstream = await makeRequest(rotatedTokens.access_token);
  }

  const responseBody = await upstream.arrayBuffer();
  const response = new NextResponse(responseBody.byteLength ? responseBody : null, {
    status: upstream.status,
    headers: {
      ...(upstream.headers.get("content-type") ? { "Content-Type": upstream.headers.get("content-type")! } : {}),
      ...(upstream.headers.get("content-disposition") ? { "Content-Disposition": upstream.headers.get("content-disposition")! } : {}),
    },
  });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
