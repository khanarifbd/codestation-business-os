import { guardMutationOrigin } from "@/lib/mutation-origin";
import { NextResponse } from "next/server";

import { requestContextHeaders } from "@/lib/request-context";
import { backendFetch } from "@/lib/server-api";

export async function proxyPublicAuthAction(request: Request, backendPath: string) {
  const rejected = guardMutationOrigin(request, { requireJson: true });
  if (rejected) return rejected;

  const body = await request.text();
  const upstream = await backendFetch(backendPath, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...requestContextHeaders(request),
    },
    body,
  });
  const payload = await upstream.json().catch(() => ({ detail: "Unexpected authentication response" }));
  return NextResponse.json(payload, { status: upstream.status });
}
