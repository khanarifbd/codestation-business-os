import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, method: "GET" | "POST", context: Context) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });

  const { path } = await context.params;
  const suffix = path.join("/");
  const headers = new Headers({ "X-Organization-ID": organizationId });
  const init: RequestInit = { method, headers };

  if (method === "POST") {
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    init.body = await request.arrayBuffer();
  }

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, `/hr-documents/${suffix}${request.nextUrl.search}`, init);
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "content-length", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  const response = new NextResponse(body, { status: upstream.status, headers: responseHeaders });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: Context) { return proxy(request, "GET", context); }
export async function POST(request: NextRequest, context: Context) { return proxy(request, "POST", context); }
