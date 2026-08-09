import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, method: "GET" | "POST" | "PATCH", context: Context) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  const { path } = await context.params;
  const headers: Record<string,string> = { "X-Organization-ID": organizationId };
  const init: RequestInit = { method, headers };
  if (method !== "GET") { headers["Content-Type"] = "application/json"; init.body = await request.text(); }
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, `/capital/${path.join("/")}${request.nextUrl.search}`, init);
  const payload = upstream.status === 204 ? null : await upstream.json().catch(() => null);
  const response = upstream.status === 204 ? new NextResponse(null,{status:204}) : NextResponse.json(payload,{status:upstream.status});
  if (rotatedTokens) setAuthCookies(response,rotatedTokens);
  return response;
}
export async function GET(request:NextRequest,context:Context){return proxy(request,"GET",context)}
export async function POST(request:NextRequest,context:Context){return proxy(request,"POST",context)}
export async function PATCH(request:NextRequest,context:Context){return proxy(request,"PATCH",context)}
