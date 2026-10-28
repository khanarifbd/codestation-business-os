import Link from "next/link";
import { CreditCard } from "lucide-react";
import { StripeCheckoutReturnStatus } from "@/components/stripe-checkout-return-status";

export const metadata = {
  title: "Stripe Checkout Return | Business OS",
  robots: { index: false, follow: false },
};

type ReturnPageProps = {
  searchParams: Promise<{ result?: string; session_id?: string }>;
};

export default async function StripeCheckoutReturnPage({ searchParams }: ReturnPageProps) {
  const params = await searchParams;
  const id = typeof params.session_id === "string" && /^cs_(live|test)_[A-Za-z0-9]{8,110}$/.test(params.session_id)
    ? params.session_id : null;
  const mode = id?.startsWith("cs_live_") ? "live" : id?.startsWith("cs_test_") ? "test" : "unknown";
  const outcome = params.result === "cancelled" ? "cancelled" : "success";

  return <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
    <section className="w-full max-w-xl rounded-2xl border bg-white p-8 shadow-sm">
      <CreditCard className="size-8 text-violet-700" />
      <h1 className="mt-4 text-2xl font-semibold">
        {mode === "live" ? "Stripe Live Checkout" : mode === "test" ? "Stripe Sandbox Checkout" : "Stripe Checkout"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        {outcome === "cancelled"
          ? "You have returned from Stripe Checkout. A cancellation redirect does not confirm a payment."
          : "You have returned from Stripe Checkout. A successful browser redirect alone does not confirm that Business OS has verified and recorded your payment."}
      </p>
      <StripeCheckoutReturnStatus mode={mode} sessionId={id} result={outcome} />
      <Link href="/dashboard" className="mt-6 inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">
        Return to your workspace
      </Link>
    </section>
  </main>;
}
