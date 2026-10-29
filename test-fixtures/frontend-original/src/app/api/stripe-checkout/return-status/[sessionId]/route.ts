import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/server-api";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { sessionId } = await params;
  if (!/^cs_(test|live)_[A-Za-z0-9]{8,110}$/.test(sessionId)) {
    return NextResponse.json({ detail: "Checkout session not found" }, { status: 404 });
  }
  try {
    const response = await backendFetch(
      `/finance/stripe-checkout/return-status/${encodeURIComponent(sessionId)}`,
    );
    const data = await response.json().catch(() => ({ detail: "Payment status unavailable" }));
    return NextResponse.json(data, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { detail: "Payment verification is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
