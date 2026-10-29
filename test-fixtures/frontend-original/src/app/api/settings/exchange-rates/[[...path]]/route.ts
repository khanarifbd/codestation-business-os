import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const init: RequestInit = { method: request.method, headers: { "X-Organization-ID": organizationId } };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    const text = await request.text();
    if (text) init.body = text;
  }
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, `/company-settings/exchange-rates${suffix}`, init);
  const response = NextResponse.json(await upstream.json().catch(() => ({ detail: "Unable to process exchange-rate request" })), { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) { return proxy(request, context); }
export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) { return proxy(request, context); }
export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) { return proxy(request, context); }
