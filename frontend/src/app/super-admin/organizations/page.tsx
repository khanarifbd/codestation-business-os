import { Building2 } from "lucide-react";

export default function SuperAdminOrganizationsPage() {
  return (
    <>
      <header>
        <p className="text-sm font-medium text-neutral-500">Platform directory</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Organizations</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Organization search, filters, subscription context and organization details will live here.
        </p>
      </header>

      <section className="mt-7 rounded-2xl border bg-white p-8 shadow-sm shadow-neutral-200/30">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-100">
          <Building2 className="size-5 text-neutral-600" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">Organization workspace ready</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          The shared Super Admin shell is active. The next organization step can now be implemented here without changing platform navigation again.
        </p>
      </section>
    </>
  );
}
