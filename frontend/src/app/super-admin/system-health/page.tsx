import { HeartPulse } from "lucide-react";

export default function SuperAdminSystemHealthPage() {
  return (
    <>
      <header>
        <p className="text-sm font-medium text-neutral-500">Platform operations</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">System Health</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          API, database, deployment version, migrations and platform service health will be monitored here.
        </p>
      </header>

      <section className="mt-7 rounded-2xl border bg-white p-8 shadow-sm shadow-neutral-200/30">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-100">
          <HeartPulse className="size-5 text-neutral-600" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">System health workspace ready</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          The shared Super Admin shell is ready for live API, database and release-health indicators in the later system-health step.
        </p>
      </section>
    </>
  );
}
