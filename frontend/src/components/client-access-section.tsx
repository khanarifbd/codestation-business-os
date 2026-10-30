"use client";

import { useDashboardSession } from "@/components/dashboard-session-context";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { BadgeCheck, Clock3, Loader2, Mail, ShieldCheck, UserPlus, X } from "lucide-react";

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

type Invitation = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  is_primary_contact: boolean;
  expires_at: string;
  last_sent_at: string;
  created_at: string;
};

type Overview = {
  client_id: string;
  display_name: string;
  suggested_email: string | null;
  suggested_full_name: string;
  account_exists_for_suggested_email: boolean;
  enabled: boolean;
  pending: boolean;
  can_manage: boolean;
  users: AccessUser[];
  invitations: Invitation[];
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export function ClientAccessSection({ clientId }: { clientId: string }) {
  const { tenant } = useDashboardSession();
  const organizationId = tenant?.organization.id;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pending = useRef(false);
  const uncertainRef = useRef(false);
  const alive = useRef(true);
  const loadEpoch = useRef(0);
  const lifecycle = useRef(0);
  const [uncertain, setUncertain] = useState(false);
  const scope = `${organizationId ?? ""}:${clientId}`;
  const ownerScope = useRef(scope);
  const [visibleScope, setVisibleScope] = useState(scope);
  const load = useCallback(async () => {
    if (ownerScope.current !== scope) return false;
    const epoch = ++loadEpoch.current;
    const current = () => alive.current && ownerScope.current === scope && epoch === loadEpoch.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/client-access/manage/client/${encodeURIComponent(clientId)}/overview`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!current()) return false;
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load client access.");
      if (!payload || payload.client_id !== clientId) throw new Error("Client access identity could not be verified.");
      setOverview(payload as Overview);
      return true;
    } catch (reason) {
      if (current()) { setOverview(null); setError(reason instanceof Error ? reason.message : "Unable to load client access."); }
      return false;
    } finally { if (current()) setLoading(false); }
  }, [clientId, scope]);

  useLayoutEffect(() => {
    ownerScope.current = scope; setVisibleScope(scope); setOverview(null);
    alive.current = true; pending.current = false; uncertainRef.current = false;
    setWorking(null); setUncertain(false); setConfirmOpen(false); setMessage(null); setError(null);
    void load();
    return () => { ownerScope.current = ""; alive.current = false; lifecycle.current += 1; loadEpoch.current += 1; };
  }, [load, scope]);

  async function mutate(key: string, path: string, method: string, body: unknown, success: string) {
    if (ownerScope.current !== scope || !overview?.can_manage || pending.current || uncertainRef.current) return;
    pending.current = true;
    const owner = lifecycle.current;
    const current = () => alive.current && ownerScope.current === scope && owner === lifecycle.current;
    setWorking(key); setError(null); setMessage(null);
    let acknowledged = false, rejected = false;
    try {
      const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      acknowledged = response.ok;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        rejected = response.status >= 400 && response.status < 500 && response.status !== 408 &&
          Boolean(payload && (typeof payload.detail === "string" || Array.isArray(payload.detail)));
        throw new Error(typeof payload?.detail === "string" ? payload.detail : "Unable to verify the client access response.");
      }
      if (!current()) return;
      setConfirmOpen(false); setMessage(success);
      await load(); // Read failure is reported separately; never replay the acknowledged write.
    } catch (reason) {
      if (current()) {
        if (!acknowledged && !rejected) {
          uncertainRef.current = true; setUncertain(true);
          setError(`The action outcome is uncertain and may already be recorded. Do not repeat the action; refresh access records to inspect the result. ${reason instanceof Error ? reason.message : ""}`);
        } else setError(reason instanceof Error ? reason.message : "Unable to update client access.");
      }
    } finally { if (current()) { pending.current = false; setWorking(null); } }
  }
  async function enableOrInvite() {
    if (!overview?.suggested_email) return;
    const existing = overview.account_exists_for_suggested_email;
    await mutate("enable", existing ? "/api/client-access" : `/api/client-access/manage/client/${encodeURIComponent(clientId)}/invite`, "POST",
      existing ? { client_id: clientId, email: overview.suggested_email, is_primary_contact: true } : { email: overview.suggested_email, full_name: overview.suggested_full_name, is_primary_contact: true },
      existing ? `Portal access granted to ${overview.suggested_email}.` : `Invitation sent to ${overview.suggested_email}.`);
  }
  async function resend(id: string) { await mutate(id, `/api/client-access/manage/invitations/${encodeURIComponent(id)}/resend`, "POST", undefined, "Client invitation resent."); }
  async function cancelInvite(id: string) { await mutate(id, `/api/client-access/manage/invitations/${encodeURIComponent(id)}`, "DELETE", undefined, "Client invitation cancelled."); }
  async function revoke(id: string) { await mutate(id, `/api/client-access?access_id=${encodeURIComponent(id)}`, "DELETE", undefined, "Client portal access revoked."); }

  const currentOverview = visibleScope === scope ? overview : null;
  return <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm sm:mt-5 sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><h2 className="break-words text-lg font-semibold">Client Access</h2></div><p className="mt-1 break-words text-sm leading-6 text-neutral-500">Manage who can sign in to this client portal. Invitations create or link a global Business OS account without making the client an employee.</p></div>
      {loading ? <Loader2 className="size-5 shrink-0 animate-spin text-neutral-400" /> : currentOverview ? <span className={`inline-flex w-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${currentOverview.enabled ? "bg-emerald-50 text-emerald-700" : currentOverview.pending ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>{currentOverview.enabled ? "Enabled" : currentOverview.pending ? "Invitation pending" : "Disabled"}</span> : null}
    </div>

    {visibleScope === scope && error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {visibleScope === scope && uncertain ? <p role="alert" className="mt-4 text-sm text-red-700">Further access changes are blocked in this view. A refresh does not prove an invitation or access change is safe to repeat.</p> : null}
    {visibleScope === scope && (error || uncertain) ? <button type="button" disabled={working !== null || loading} onClick={() => void load()} className="mt-3 rounded-lg border px-3 py-2 text-sm">Refresh access records</button> : null}
    {visibleScope === scope && message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {!loading && currentOverview ? <div className="mt-5 space-y-4">
      {currentOverview.users.length ? <div className="overflow-hidden rounded-xl border"><div className="border-b bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Portal users</div><div className="divide-y">{currentOverview.users.map((user) => <div key={user.access_id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><BadgeCheck className="size-4 shrink-0 text-emerald-600" /><p className="break-words font-medium">{user.full_name}</p>{user.is_primary_contact ? <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">Primary</span> : null}</div><p className="mt-1 break-all text-sm text-neutral-500">{user.email}</p></div>{currentOverview.can_manage ? <button disabled={working !== null || uncertain} onClick={() => void revoke(user.access_id)} className="h-10 w-full rounded-lg border px-3 text-xs font-semibold text-red-600 disabled:opacity-50 sm:h-auto sm:w-auto sm:py-2">{working === user.access_id ? "Revoking…" : "Revoke access"}</button> : null}</div>)}</div></div> : null}

      {currentOverview.invitations.map((invite) => <div key={invite.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><Clock3 className="size-4 shrink-0 text-amber-700" /><p className="font-medium">Invitation pending</p></div><p className="mt-1 break-words text-sm text-neutral-600">{invite.full_name} · <span className="break-all">{invite.email}</span></p><p className="mt-1 break-words text-xs leading-5 text-neutral-400">Expires {dateTime(invite.expires_at)} · Last sent {dateTime(invite.last_sent_at)}</p></div>{currentOverview.can_manage ? <div className="grid grid-cols-2 gap-2 sm:flex"><button disabled={working !== null || uncertain} onClick={() => void resend(invite.id)} className="h-10 rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-50 sm:h-auto sm:py-2">Resend</button><button disabled={working !== null || uncertain} onClick={() => void cancelInvite(invite.id)} className="h-10 rounded-lg border bg-white px-3 text-xs font-semibold text-red-600 disabled:opacity-50 sm:h-auto sm:py-2">Cancel invite</button></div> : null}</div></div>)}

      {!currentOverview.enabled && !currentOverview.pending ? <div className="rounded-xl border border-dashed p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-medium">No portal user has access yet</p><p className="mt-1 break-words text-sm leading-6 text-neutral-500">{currentOverview.suggested_email ? currentOverview.account_exists_for_suggested_email ? `${currentOverview.suggested_email} already has a Business OS account.` : `${currentOverview.suggested_email} does not have a Business OS account yet. An invitation will let them create one and join this client portal.` : "Add an email or billing email to the client record before enabling portal access."}</p></div>{currentOverview.can_manage && currentOverview.suggested_email ? <button disabled={working !== null || uncertain} onClick={() => { if (!pending.current && !uncertainRef.current) setConfirmOpen(true); }} className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white sm:h-10 sm:w-auto"><UserPlus className="size-4" />{currentOverview.account_exists_for_suggested_email ? "Grant access" : "Invite client"}</button> : null}</div></div> : null}
    </div> : null}

    {visibleScope === scope && confirmOpen && currentOverview ? <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4"><div className="h-full max-h-[100dvh] w-full overflow-y-auto bg-white p-4 shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl sm:p-6"><div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-start justify-between gap-4 border-b bg-white px-4 py-4 sm:static sm:mx-0 sm:mt-0 sm:border-0 sm:p-0"><div className="min-w-0"><h3 className="break-words text-lg font-semibold">{currentOverview.account_exists_for_suggested_email ? "Grant client portal access?" : "Invite client to Business OS?"}</h3><p className="mt-2 break-words text-sm leading-6 text-neutral-500">{currentOverview.account_exists_for_suggested_email ? `${currentOverview.suggested_email} already has a Business OS account. Grant access to this client portal?` : `${currentOverview.suggested_email} has no Business OS account yet. Send a secure email invitation so they can create an account and join this company as a client?`}</p></div><button disabled={working !== null} onClick={() => { if (!pending.current) setConfirmOpen(false); }} className="shrink-0 rounded-lg border p-2"><X className="size-4" /></button></div><div className="mt-5 rounded-xl bg-neutral-50 p-4 text-sm"><div className="flex items-start gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-neutral-400" /><span className="break-all">{currentOverview.suggested_email}</span></div><p className="mt-2 text-xs leading-5 text-neutral-400">Client relationship only. This does not create an employee record or company ownership.</p></div><div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end"><button disabled={working !== null} onClick={() => { if (!pending.current) setConfirmOpen(false); }} className="h-11 rounded-xl border px-4 text-sm font-medium sm:h-10">Cancel</button><button disabled={working !== null || uncertain} onClick={() => void enableOrInvite()} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:h-10">{working === "enable" ? "Working…" : currentOverview.account_exists_for_suggested_email ? "Grant access" : "Send invitation"}</button></div></div></div> : null}
  </section>;
}
