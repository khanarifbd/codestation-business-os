import { UsersRound } from "lucide-react";

export default function SuperAdminUsersPage() {
  return (
    <>
      <header>
        <p className="text-sm font-medium text-neutral-500">Global identity administration</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Users</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-500">
          Global users, organization memberships, account status and security context will live here.
        </p>
      </header>

      <section className="mt-7 rounded-2xl border bg-white p-8 shadow-sm shadow-neutral-200/30">
        <div className="flex size-11 items-center justify-center rounded-xl bg-neutral-100">
          <UsersRound className="size-5 text-neutral-600" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">User administration workspace ready</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          The shared platform shell is now available for the dedicated user list, search, details and session controls.
        </p>
      </section>
    </>
  );
}
