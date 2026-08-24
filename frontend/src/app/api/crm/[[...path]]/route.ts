import { NextRequest, NextResponse } from "next/server";

import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

type RouteContext = { params: Promise<{ path?: string[] }> };

type ValidationIssue = {
  loc?: unknown[];
  msg?: unknown;
  type?: unknown;
};

function humanizeField(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload;
  const source = payload as { detail?: unknown };
  if (!Array.isArray(source.detail)) return payload;

  const messages = source.detail
    .map((entry) => {
      if (!entry || typeof entry !== "object") return String(entry);
      const issue = entry as ValidationIssue;
      const location = Array.isArray(issue.loc)
        ? issue.loc.filter((item) => item !== "body").map(String)
        : [];
      const field = location.length ? humanizeField(location.join(" → ")) : "Request";
      const message = typeof issue.msg === "string" ? issue.msg : "Invalid value";
      return `${field}: ${message}`;
    })
    .filter(Boolean);

  return {
    ...(payload as Record<string, unknown>),
    detail: messages.length ? messages.join(" · ") : "Please check the submitted client information.",
    validation_errors: source.detail,
  };
}

async function proxy(request: NextRequest, context: RouteContext, method: string) {
  const organizationId = request.cookies.get("organization_id")?.value;
  if (!organizationId) {
    return NextResponse.json({ detail: "No active workspace selected" }, { status: 409 });
  }

  const { path = [] } = await context.params;
  const suffix = path.length ? `/${path.join("/")}` : "";
  const query = method === "GET" ? request.nextUrl.search : "";
  const body = method === "GET" || method === "DELETE" ? undefined : await request.text();

  const { upstream, rotatedTokens } = await authenticatedBackendFetch(
    request,
    `/crm${suffix}${query}`,
    {
      method,
      headers: {
        "X-Organization-ID": organizationId,
        ...(body ? { "Content-Type": request.headers.get("content-type") ?? "application/json" } : {}),
      },
      body,
    },
  );

  if (upstream.status === 204) {
    const response = new NextResponse(null, { status: 204 });
    if (rotatedTokens) setAuthCookies(response, rotatedTokens);
    return response;
  }

  const upstreamPayload = await upstream.json().catch(() => ({ detail: "Unexpected upstream response" }));
  const payload = upstream.status === 422 ? normalizeErrorPayload(upstreamPayload) : upstreamPayload;
  const response = NextResponse.json(payload, { status: upstream.status });
  if (rotatedTokens) setAuthCookies(response, rotatedTokens);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "POST");
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PUT");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PATCH");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "DELETE");
}
