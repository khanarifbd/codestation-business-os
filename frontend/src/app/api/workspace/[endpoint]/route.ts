import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

export async function GET(request: NextRequest, context: { params: Promise<{ endpoint: string }> }) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  const { endpoint } = await context.params;
  if (!['me', 'notifications'].includes(endpoint)) return NextResponse.json({ detail: 'Not found' }, { status: 404 });
  const { upstream, rotatedTokens } = await authenticatedBackendFetch(request, `/workspace/${endpoint}`, { headers: { "X-Organization-ID": organizationId } });
  const response = NextResponse.json(await upstream.json(), { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}
