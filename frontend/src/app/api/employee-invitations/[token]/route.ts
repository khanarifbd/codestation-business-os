import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/server-api";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const upstream = await backendFetch(`/employee-invitations/${encodeURIComponent(token)}`);
  const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  return NextResponse.json(payload, { status: upstream.status });
}
