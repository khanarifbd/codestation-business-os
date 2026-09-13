import { CreditCard } from "lucide-react";

export default function SuperAdminSubscriptionsPage() {
  return (
    <>
      <header>
        <p className="text-sm font-medium text-neutral-500">Commercial administration</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Subscriptions</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Plans, trials, billing cycles, renewal dates and subscription status management will live here.
        </p>
      </header>

      <section className="mt-7 rounded-2xl border bg-white p-8 shadow-sm shadow-neutral-200/30">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-100">
          <CreditCard className="size-5 text-neutral-600" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">Subscription workspace ready</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          The navigation foundation is ready for the dedicated subscription and plan management step.
        </p>
      </section>
    </>
  );
}
