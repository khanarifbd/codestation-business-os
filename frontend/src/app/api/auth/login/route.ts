import { NextResponse } from "next/server";

import { setAuthCookies, type TokenPair } from "@/lib/auth-session";
import { backendFetch } from "@/lib/server-api";

export async function POST(request: Request) {
  const body = await request.text();
  const upstream = await backendFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const payload = await upstream.json();
  if (!upstream.ok) {
    return NextResponse.json(payload, { status: upstream.status });
  }

  const tokens = payload as TokenPair;
  const response = NextResponse.json({ user: tokens.user });
  setAuthCookies(response, tokens);
  return response;
}
