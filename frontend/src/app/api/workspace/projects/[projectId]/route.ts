import { NextRequest } from "next/server";

import { proxyTenantRequest } from "@/lib/tenant-proxy";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { projectId } = await context.params;
  return proxyTenantRequest(request, `/workspace/projects/${encodeURIComponent(projectId)}${request.nextUrl.search}`);
}
