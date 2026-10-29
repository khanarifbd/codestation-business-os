import { NextRequest, NextResponse } from "next/server";

import { requestContextHeaders } from "@/lib/request-context";
import { backendFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  const upstream = await backendFetch("/auth/passkeys/options", {
    method: "POST",
    headers: requestContextHeaders(request),
  });
  const payload = await upstream.json().catch(() => ({ detail: "Unable to start passkey sign-in." }));
  return NextResponse.json(payload, { status: upstream.status });
}
