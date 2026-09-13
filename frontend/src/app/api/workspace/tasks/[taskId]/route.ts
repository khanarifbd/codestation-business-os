import { NextRequest } from "next/server";

import { proxyTenantRequest } from "@/lib/tenant-proxy";

type RouteContext = { params: Promise<{ taskId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { taskId } = await context.params;
  return proxyTenantRequest(request, `/workspace/tasks/${encodeURIComponent(taskId)}${request.nextUrl.search}`);
}
