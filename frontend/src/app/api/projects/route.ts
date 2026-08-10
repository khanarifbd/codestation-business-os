import { NextRequest } from "next/server";

import { proxyTenantRequest } from "@/lib/tenant-proxy";

async function forward(request: NextRequest) {
  return proxyTenantRequest(request, `/projects${request.nextUrl.search}`);
}

export async function GET(request: NextRequest) { return forward(request); }
export async function POST(request: NextRequest) { return forward(request); }
export async function PATCH(request: NextRequest) { return forward(request); }
export async function PUT(request: NextRequest) { return forward(request); }
export async function DELETE(request: NextRequest) { return forward(request); }
