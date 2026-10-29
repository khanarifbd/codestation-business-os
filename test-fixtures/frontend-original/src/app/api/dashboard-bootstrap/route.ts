import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

const secure = process.env.NODE_ENV === "production";

export async function GET(request: NextRequest) {
  const organizationId = request.cookies.get("organization_id")?.value;
  const headers: Record<string, string> = {};
  if (organizationId) headers["X-Organization-ID"] = organizationId;

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    "/organizations/bootstrap",
    { headers },
  );
  const payload = await upstream.json().catch(() => ({ detail: "Unable to load dashboard session" }));
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);

  if (upstream.ok) {
    const selectedOrganizationId = payload?.tenant?.organization?.id as string | undefined;
    if (selectedOrganizationId && selectedOrganizationId !== organizationId) {
      response.cookies.set("organization_id", selectedOrganizationId, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
      });
    } else if (!selectedOrganizationId && organizationId) {
      response.cookies.set("organization_id", "", {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
  }

  return response;
}
