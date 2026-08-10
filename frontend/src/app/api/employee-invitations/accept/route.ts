import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const upstream = await backendFetch("/employee-invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const payload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  return NextResponse.json(payload, { status: upstream.status });
}
