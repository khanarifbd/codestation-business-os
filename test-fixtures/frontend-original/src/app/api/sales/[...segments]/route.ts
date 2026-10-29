import { NextRequest } from "next/server";

import { proxyTenantRequest } from "@/lib/tenant-proxy";

type RouteContext = { params: Promise<{ segments: string[] }> };

async function forward(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  const path = `/sales/${segments.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
  return proxyTenantRequest(request, path);
}

export async function GET(request: NextRequest, context: RouteContext) { return forward(request, context); }
export async function POST(request: NextRequest, context: RouteContext) { return forward(request, context); }
export async function PATCH(request: NextRequest, context: RouteContext) { return forward(request, context); }
export async function PUT(request: NextRequest, context: RouteContext) { return forward(request, context); }
export async function DELETE(request: NextRequest, context: RouteContext) { return forward(request, context); }
