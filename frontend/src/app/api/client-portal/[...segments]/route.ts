import { NextRequest } from "next/server";

import { proxyTenantRequest } from "@/lib/tenant-proxy";

type RouteContext = { params: Promise<{ segments: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = `/client-portal/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  return proxyTenantRequest(request, path);
}
