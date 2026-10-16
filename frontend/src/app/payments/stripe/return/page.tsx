import Link from "next/link";
import { CreditCard, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Stripe Sandbox Checkout | Business OS",
  robots: { index: false, follow: false },
};

export default function StripeSandboxReturnPage() {
  return <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
    <section className="w-full max-w-xl rounded-2xl border bg-white p-8 shadow-sm">
      <CreditCard className="size-8 text-violet-700" />
      <h1 className="mt-4 text-2xl font-semibold">Stripe Sandbox Checkout</h1>
      <p className="mt-3 text-sm leading-6 text-neutral-600">The Stripe test checkout has returned to Business OS. A browser redirect alone does not confirm payment. The organization must receive and verify a signed Stripe webhook before the test session is marked paid.</p>
      <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Sandbox transactions never change real invoice balances or accounting records.</p>
      <Link href="/" className="mt-6 inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Return to Business OS</Link>
    </section>
  </main>;
}
