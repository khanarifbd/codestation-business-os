"use client";

import { useCallback, useEffect, useState } from "react";
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
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function ClientAccessSection({ clientId }: { clientId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const response = await fetch(`/api/client-access/manage/client/${encodeURIComponent(clientId)}/overview`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) setError(payload?.detail ?? "Unable to load client access.");
    else setOverview(payload as Overview);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  async function enableOrInvite() {
    if (!overview?.suggested_email || !overview.can_manage) return;
    setWorking("enable"); setError(null); setMessage(null);
    try {
      if (overview.account_exists_for_suggested_email) {
        const response = await fetch("/api/client-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, email: overview.suggested_email, is_primary_contact: true }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to grant client portal access.");
        setMessage(`Portal access granted to ${overview.suggested_email}.`);
      } else {
        const response = await fetch(`/api/client-access/manage/client/${encodeURIComponent(clientId)}/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: overview.suggested_email, full_name: overview.suggested_full_name, is_primary_contact: true }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.detail ?? "Unable to send client invitation.");
        setMessage(`Invitation sent to ${overview.suggested_email}.`);
      }
      setConfirmOpen(false);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update client access.");
    } finally { setWorking(null); }
  }

  async function resend(invitationId: string) {
    setWorking(invitationId); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/client-access/manage/invitations/${encodeURIComponent(invitationId)}/resend`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to resend invitation.");
      setMessage("Client invitation resent."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to resend invitation."); }
    finally { setWorking(null); }
  }

  async function cancelInvite(invitationId: string) {
    setWorking(invitationId); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/client-access/manage/invitations/${encodeURIComponent(invitationId)}`, { method: "DELETE" });
      if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.detail ?? "Unable to cancel invitation."); }
      setMessage("Client invitation cancelled."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to cancel invitation."); }
    finally { setWorking(null); }
  }

  async function revoke(accessId: string) {
    setWorking(accessId); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/client-access?access_id=${encodeURIComponent(accessId)}`, { method: "DELETE" });
      if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.detail ?? "Unable to revoke portal access."); }
      setMessage("Client portal access revoked."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to revoke portal access."); }
    finally { setWorking(null); }
  }

  return <section className="mt-4 rounded-2xl border bg-white p-4 shadow-sm sm:mt-5 sm:p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><h2 className="break-words text-lg font-semibold">Client Access</h2></div><p className="mt-1 break-words text-sm leading-6 text-neutral-500">Manage who can sign in to this client portal. Invitations create or link a global Business OS account without making the client an employee.</p></div>
      {loading ? <Loader2 className="size-5 shrink-0 animate-spin text-neutral-400" /> : overview ? <span className={`inline-flex w-fit shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${overview.enabled ? "bg-emerald-50 text-emerald-700" : overview.pending ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-600"}`}>{overview.enabled ? "Enabled" : overview.pending ? "Invitation pending" : "Disabled"}</span> : null}
    </div>

    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {!loading && overview ? <div className="mt-5 space-y-4">
      {overview.users.length ? <div className="overflow-hidden rounded-xl border"><div className="border-b bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Portal users</div><div className="divide-y">{overview.users.map((user) => <div key={user.access_id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><BadgeCheck className="size-4 shrink-0 text-emerald-600" /><p className="break-words font-medium">{user.full_name}</p>{user.is_primary_contact ? <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">Primary</span> : null}</div><p className="mt-1 break-all text-sm text-neutral-500">{user.email}</p></div>{overview.can_manage ? <button disabled={working !== null} onClick={() => void revoke(user.access_id)} className="h-10 w-full rounded-lg border px-3 text-xs font-semibold text-red-600 disabled:opacity-50 sm:h-auto sm:w-auto sm:py-2">{working === user.access_id ? "Revoking…" : "Revoke access"}</button> : null}</div>)}</div></div> : null}

      {overview.invitations.map((invite) => <div key={invite.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><Clock3 className="size-4 shrink-0 text-amber-700" /><p className="font-medium">Invitation pending</p></div><p className="mt-1 break-words text-sm text-neutral-600">{invite.full_name} · <span className="break-all">{invite.email}</span></p><p className="mt-1 break-words text-xs leading-5 text-neutral-400">Expires {dateTime(invite.expires_at)} · Last sent {dateTime(invite.last_sent_at)}</p></div>{overview.can_manage ? <div className="grid grid-cols-2 gap-2 sm:flex"><button disabled={working !== null} onClick={() => void resend(invite.id)} className="h-10 rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-50 sm:h-auto sm:py-2">Resend</button><button disabled={working !== null} onClick={() => void cancelInvite(invite.id)} className="h-10 rounded-lg border bg-white px-3 text-xs font-semibold text-red-600 disabled:opacity-50 sm:h-auto sm:py-2">Cancel invite</button></div> : null}</div></div>)}

      {!overview.enabled && !overview.pending ? <div className="rounded-xl border border-dashed p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="font-medium">No portal user has access yet</p><p className="mt-1 break-words text-sm leading-6 text-neutral-500">{overview.suggested_email ? overview.account_exists_for_suggested_email ? `${overview.suggested_email} already has a Business OS account.` : `${overview.suggested_email} does not have a Business OS account yet. An invitation will let them create one and join this client portal.` : "Add an email or billing email to the client record before enabling portal access."}</p></div>{overview.can_manage && overview.suggested_email ? <button onClick={() => setConfirmOpen(true)} className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white sm:h-10 sm:w-auto"><UserPlus className="size-4" />{overview.account_exists_for_suggested_email ? "Grant access" : "Invite client"}</button> : null}</div></div> : null}
    </div> : null}

    {confirmOpen && overview ? <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4"><div className="h-full max-h-[100dvh] w-full overflow-y-auto bg-white p-4 shadow-2xl sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-2xl sm:p-6"><div className="sticky top-0 z-10 -mx-4 -mt-4 flex items-start justify-between gap-4 border-b bg-white px-4 py-4 sm:static sm:mx-0 sm:mt-0 sm:border-0 sm:p-0"><div className="min-w-0"><h3 className="break-words text-lg font-semibold">{overview.account_exists_for_suggested_email ? "Grant client portal access?" : "Invite client to Business OS?"}</h3><p className="mt-2 break-words text-sm leading-6 text-neutral-500">{overview.account_exists_for_suggested_email ? `${overview.suggested_email} already has a Business OS account. Grant access to this client portal?` : `${overview.suggested_email} has no Business OS account yet. Send a secure email invitation so they can create an account and join this company as a client?`}</p></div><button onClick={() => setConfirmOpen(false)} className="shrink-0 rounded-lg border p-2"><X className="size-4" /></button></div><div className="mt-5 rounded-xl bg-neutral-50 p-4 text-sm"><div className="flex items-start gap-2"><Mail className="mt-0.5 size-4 shrink-0 text-neutral-400" /><span className="break-all">{overview.suggested_email}</span></div><p className="mt-2 text-xs leading-5 text-neutral-400">Client relationship only. This does not create an employee record or company ownership.</p></div><div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:justify-end"><button onClick={() => setConfirmOpen(false)} className="h-11 rounded-xl border px-4 text-sm font-medium sm:h-10">Cancel</button><button disabled={working !== null} onClick={() => void enableOrInvite()} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:h-10">{working === "enable" ? "Working…" : overview.account_exists_for_suggested_email ? "Grant access" : "Send invitation"}</button></div></div></div> : null}
  </section>;
}
