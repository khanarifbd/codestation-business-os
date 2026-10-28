"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, Clock3, ShieldCheck, AlertTriangle } from "lucide-react";

type CheckoutMode = "live" | "test" | "unknown";
type PaymentState = "checking" | "processing" | "posted" | "reversed" | "review_required" | "sandbox_paid" | "pending" | "unavailable";

type ReturnStatusProps = { mode: CheckoutMode; sessionId: string | null; result: string };

export function StripeCheckoutReturnStatus(props: ReturnStatusProps) {
  // A different return must never display the previous session's posting status,
  // even in the render before passive effects run. No role or payment authority
  // is inferred from these public URL parameters.
  const identity = JSON.stringify([props.sessionId, props.mode, props.result]);
  return <CheckoutReturnSession key={identity} {...props} />;
}

function CheckoutReturnSession({ mode, sessionId, result }: ReturnStatusProps) {
  const [state, setState] = useState<PaymentState>("checking");
  const lifetime = useRef<object | null>(null);
  useLayoutEffect(() => {
    const generation = {};
    lifetime.current = generation;
    return () => { if (lifetime.current === generation) lifetime.current = null; };
  }, []);

  useEffect(() => {
    if (!sessionId || mode === "unknown") return;
    const generation = lifetime.current;
    let active = true;
    const current = () => active && generation !== null && lifetime.current === generation;
    let pollCount = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      if (!current()) return;
      try {
        const response = await fetch(
          `/api/stripe-checkout/return-status/${encodeURIComponent(sessionId!)}`,
          { cache: "no-store" },
        );
        if (!current()) return;
        const data = await response.json().catch(() => null);
        if (!current()) return;
        if (response.ok && ["posted", "reversed", "review_required", "processing", "sandbox_paid", "pending"].includes(data?.status)) {
          setState(data.status as PaymentState);
          if (data.status === "posted" || data.status === "reversed" || data.status === "review_required" || data.status === "sandbox_paid") return;
        } else {
          setState("unavailable");
        }
      } catch {
        if (current()) setState("unavailable");
      }
      pollCount += 1;
      if (current() && pollCount < 12) timer = setTimeout(() => { void check(); }, 4000);
    }

    void check();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [sessionId, mode]);

  if (!sessionId || mode === "unknown") {
    return <div role="status" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      No valid Stripe Checkout session was found in this return URL. Check the transaction in Stripe before retrying.
    </div>;
  }

  if (mode === "test") {
    return <div role="status" className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <ShieldCheck className="mt-0.5 size-4 shrink-0"/>
      <span><strong>Sandbox only.</strong> Test payments never change real Invoice, Financial Account or Journal balances.
      {state === "sandbox_paid" ? " The test session has been recorded." : ""}</span>
    </div>;
  }

  if (state === "posted") {
    return <div role="status" className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0"/>
      <span><strong>Payment verified and posted to Business OS.</strong> The company can now review the Invoice, Stripe Clearing Account, processing fee, and Journal.</span>
    </div>;
  }

  if (state === "reversed") {
    return <div role="status" className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <span><strong>This Stripe payment was reversed.</strong> The seller can review the refund or chargeback in Business OS. Do not rely on the original checkout redirect as proof of a current paid balance.</span>
    </div>;
  }

  if (state === "review_required") {
    return <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-5 shrink-0"/>
      <span><strong>Payment needs reconciliation.</strong> The company must verify this transaction with Stripe and review the invoice allocation. Do not pay again.</span>
    </div>;
  }

  return <div role="status" className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
    <Clock3 className="mt-0.5 size-5 shrink-0"/>
    <span><strong>{result === "cancelled" ? "Checkout returned without a confirmation." : "Awaiting verified payment posting."}</strong>{" "}
      {state === "unavailable" ? "Business OS cannot currently retrieve the invoice posting status." :
      "This page does not mark an Invoice paid. Business OS verifies the payment through Stripe before posting to Accounting."}
      {" "}If Stripe charged you but the invoice still shows Due, ask the seller to use <strong>Verify payment</strong> on the invoice. Do not pay twice.
    </span>
  </div>;
}
