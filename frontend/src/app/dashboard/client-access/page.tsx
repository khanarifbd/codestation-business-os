"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Link2, Loader2, RefreshCw, ShieldCheck, Unlink, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

type AccessUser = {
  access_id: string;
  membership_id: string;
  user_id: string;
  full_name: string;
  email: string;
  is_primary_contact: boolean;
  membership_role: string;
  membership_status: string;
};

type ClientAccessRecord = {
  client_id: string;
  client_code: string;
  display_name: string;
  client_type: string;
  email: string | null;
  status: string;
  users: AccessUser[];
};

export default function ClientAccessPage() {
  const router = useRouter();
  const [items, setItems] = useState<ClientAccessRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/client-access", { cache: "no-store" });
      if (response.status === 401) { router.replace("/login"); return; }
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load client access");
      setItems(payload as ClientAccessRecord[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load client access");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  async function grant(item: ClientAccessRecord) {
    if (!item.email) return;
    setWorkingId(item.client_id); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/client-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: item.client_id, email: item.email, is_primary_contact: true }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to grant client access");
      setMessage(`Client portal access granted to ${item.email}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to grant client access");
    } finally { setWorkingId(null); }
  }

  async function revoke(user: AccessUser) {
    setWorkingId(user.access_id); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/client-access?access_id=${encodeURIComponent(user.access_id)}`, { method: "DELETE" });
      const payload = response.status === 204 ? null : await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to revoke client access");
      setMessage(`Client portal access revoked for ${user.email}`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to revoke client access");
    } finally { setWorkingId(null); }
  }

  return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-[1300px]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Identity & relationships</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Client Access</h1><p className="mt-2 max-w-3xl text-sm text-neutral-500">Link an existing CRM client to the same global Business OS account they already use elsewhere. The client gets a restricted client workspace without employee or internal company permissions.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></header>

    <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">Safe linking rule</p><p className="mt-1 text-blue-700">The email must already have a Business OS user account. We never silently create a login from a CRM email. If the client has not signed up yet, ask them to sign up with the same email first, then grant access here.</p></div></div></div>
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
      {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></div> : items.length === 0 ? <div className="px-6 py-20 text-center"><Building2 className="mx-auto size-8 text-neutral-300" /><h2 className="mt-4 font-semibold">No clients yet</h2><p className="mt-1 text-sm text-neutral-500">Create CRM clients first, then their portal access can be linked here.</p></div> : <div className="divide-y">{items.map((item) => <article key={item.client_id} className="p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{item.display_name}</h2><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase text-neutral-500">{item.client_type}</span></div><p className="mt-1 text-xs text-neutral-400">{item.client_code} · {item.email ?? "No client email"}</p></div>{item.email && item.users.length === 0 ? <button type="button" disabled={workingId !== null} onClick={() => void grant(item)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{workingId === item.client_id ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Grant portal access</button> : !item.email ? <span className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Add an email to this client first</span> : null}</div>
          {item.users.length ? <div className="mt-4 grid gap-3">{item.users.map((user) => <div key={user.access_id} className="flex flex-col gap-3 rounded-xl border bg-neutral-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-full bg-white"><UserRound className="size-4" /></span><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{user.full_name}</p>{user.is_primary_contact ? <span className="rounded-full bg-neutral-950 px-2 py-0.5 text-[10px] font-semibold text-white">Primary</span> : null}</div><p className="mt-0.5 text-xs text-neutral-400">{user.email} · membership {user.membership_status}</p></div></div><button type="button" disabled={workingId !== null} onClick={() => void revoke(user)} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-semibold text-neutral-600 disabled:opacity-50">{workingId === user.access_id ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />} Revoke</button></div>)}</div> : null}
        </article>)}</div>}
    </section>
  </div></main>;
}
