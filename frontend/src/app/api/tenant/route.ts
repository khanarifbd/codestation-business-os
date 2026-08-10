import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

const secure = process.env.NODE_ENV === "production";

async function loadContext(request: NextRequest, organizationId: string) {
  return authenticatedBackendFetch(request, "/tenant/context", {
    headers: { "X-Organization-ID": organizationId },
  });
}

export async function GET(request: NextRequest) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const { upstream, rotatedTokens } = await loadContext(request, organizationId);
  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { organization_id?: string };
  if (!body.organization_id) {
    return NextResponse.json({ detail: "organization_id is required" }, { status: 400 });
  }

  const { upstream, rotatedTokens } = await loadContext(request, body.organization_id);
  const payload = await upstream.json();
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);

  if (upstream.ok) {
    response.cookies.set("organization_id", body.organization_id, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  }

  return response;
}
