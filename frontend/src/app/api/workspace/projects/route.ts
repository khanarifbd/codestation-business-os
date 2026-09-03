import { NextRequest } from "next/server";

import { proxyTenantRequest } from "@/lib/tenant-proxy";

export async function GET(request: NextRequest) {
  return proxyTenantRequest(request, `/workspace/projects${request.nextUrl.search}`);
}
