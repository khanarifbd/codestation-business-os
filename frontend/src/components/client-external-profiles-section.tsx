"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Link2, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { SearchableSelect, type SearchOption } from "@/components/searchable-select";

type SourceOption = { id: string; name: string; slug: string; is_active: boolean };
type ExternalProfile = {
  id: string;
  platform: string;
  profile_url: string;
  username_handle: string | null;
  label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
type Overview = {
  client_id: string;
  acquisition_source_id: string | null;
  acquisition_source_name: string | null;
  can_manage: boolean;
  sources: SourceOption[];
  profiles: ExternalProfile[];
};

type ProfileDraft = {
  id?: string;
  platform: string;
  profile_url: string;
  username_handle: string;
  label: string;
  notes: string;
};

const PLATFORM_OPTIONS: SearchOption[] = [
  { value: "fiverr", label: "Fiverr" },
  { value: "upwork", label: "Upwork" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "github", label: "GitHub" },
  { value: "freelancer", label: "Freelancer.com" },
  { value: "peopleperhour", label: "PeoplePerHour" },
  { value: "contra", label: "Contra" },
  { value: "facebook", label: "Facebook" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

const emptyDraft: ProfileDraft = { platform: "fiverr", profile_url: "", username_handle: "", label: "", notes: "" };

function platformLabel(value: string) {
  return PLATFORM_OPTIONS.find((item) => item.value === value)?.label ?? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ClientExternalProfilesSection({ clientId }: { clientId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/crm/clients/${encodeURIComponent(clientId)}/external-profiles/overview`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) setError(payload?.detail ?? "Unable to load client source and external profiles.");
    else setOverview(payload as Overview);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  const sourceOptions = useMemo<SearchOption[]>(() => {
    return (overview?.sources ?? []).map((item) => ({ value: item.id, label: item.is_active ? item.name : `${item.name} (Inactive)` }));
  }, [overview]);

  async function changeSource(sourceId: string) {
    if (!overview?.can_manage || working) return;
    setWorking("source"); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/crm/clients/${encodeURIComponent(clientId)}/acquisition-source`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acquisition_source_id: sourceId || null }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to update client source.");
      setOverview(payload as Overview);
      setMessage("Client acquisition source updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update client source."); }
    finally { setWorking(null); }
  }

  function editProfile(profile: ExternalProfile) {
    setDraft({
      id: profile.id,
      platform: profile.platform,
      profile_url: profile.profile_url,
      username_handle: profile.username_handle ?? "",
      label: profile.label ?? "",
      notes: profile.notes ?? "",
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !overview?.can_manage || working) return;
    setWorking(draft.id ?? "new"); setError(null); setMessage(null);
    try {
      const path = draft.id
        ? `/api/crm/clients/${encodeURIComponent(clientId)}/external-profiles/${encodeURIComponent(draft.id)}`
        : `/api/crm/clients/${encodeURIComponent(clientId)}/external-profiles`;
      const response = await fetch(path, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: draft.platform,
          profile_url: draft.profile_url,
          username_handle: draft.username_handle.trim() || null,
          label: draft.label.trim() || null,
          notes: draft.notes.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save external profile.");
      setDraft(null);
      setMessage(draft.id ? "External profile updated." : "External profile added.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save external profile."); }
    finally { setWorking(null); }
  }

  async function deleteProfile(profile: ExternalProfile) {
    if (!overview?.can_manage || working) return;
    if (!window.confirm(`Remove ${platformLabel(profile.platform)} profile from this client?`)) return;
    setWorking(profile.id); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/crm/clients/${encodeURIComponent(clientId)}/external-profiles/${encodeURIComponent(profile.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to remove external profile.");
      }
      setMessage("External profile removed.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove external profile."); }
    finally { setWorking(null); }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><Link2 className="size-5" /><h2 className="text-lg font-semibold">Client Source & External Profiles</h2></div>
        <p className="mt-1 text-sm text-neutral-500">Track where the client relationship started and keep marketplace or professional profile links with the client record.</p>
      </div>
      {overview?.can_manage ? <button type="button" onClick={() => setDraft({ ...emptyDraft })} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" />Add profile</button> : null}
    </div>

    {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

    {loading ? <div className="flex min-h-28 items-center justify-center"><Loader2 className="size-5 animate-spin text-neutral-400" /></div> : overview ? <div className="mt-5 grid gap-5 xl:grid-cols-[0.72fr_1.28fr]">
      <div className="rounded-xl border bg-neutral-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Acquisition source</p>
        {overview.can_manage ? <div className="mt-3"><SearchableSelect value={overview.acquisition_source_id ?? ""} onValueChange={(value) => void changeSource(value)} options={sourceOptions} placeholder="No source selected" searchPlaceholder="Search source..." disabled={working === "source"} /></div> : <p className="mt-3 font-medium">{overview.acquisition_source_name ?? "Not set"}</p>}
        <p className="mt-3 text-xs leading-5 text-neutral-400">This records where the client relationship was acquired. Individual orders may still have a different order source.</p>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">External profiles</p><span className="text-xs text-neutral-400">{overview.profiles.length} saved</span></div>
        {overview.profiles.length ? <div className="grid gap-3 md:grid-cols-2">{overview.profiles.map((profile) => <article key={profile.id} className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{profile.label || platformLabel(profile.platform)}</p><p className="mt-1 text-xs text-neutral-400">{platformLabel(profile.platform)}{profile.username_handle ? ` · ${profile.username_handle}` : ""}</p></div>{overview.can_manage ? <div className="flex shrink-0 gap-1"><button type="button" onClick={() => editProfile(profile)} className="rounded-lg border p-2 text-neutral-500 hover:text-neutral-950" title="Edit profile"><Pencil className="size-3.5" /></button><button type="button" disabled={working === profile.id} onClick={() => void deleteProfile(profile)} className="rounded-lg border p-2 text-red-500 disabled:opacity-50" title="Remove profile"><Trash2 className="size-3.5" /></button></div> : null}</div>
          <a href={profile.profile_url} target="_blank" rel="noreferrer noopener" className="mt-3 flex min-w-0 items-center gap-2 text-sm font-medium text-blue-700 hover:underline"><span className="truncate">{profile.profile_url}</span><ExternalLink className="size-3.5 shrink-0" /></a>
          {profile.notes ? <p className="mt-3 text-xs leading-5 text-neutral-500">{profile.notes}</p> : null}
        </article>)}</div> : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-neutral-400">No Fiverr, Upwork, LinkedIn or other external profiles saved yet.</div>}
      </div>
    </div> : null}

    {draft ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !working) setDraft(null); }}><form onSubmit={saveProfile} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h3 className="text-lg font-semibold">{draft.id ? "Edit external profile" : "Add external profile"}</h3><p className="mt-1 text-sm text-neutral-500">Save a marketplace, professional network or other client profile URL.</p></div><button type="button" disabled={Boolean(working)} onClick={() => setDraft(null)} className="rounded-lg border p-2 disabled:opacity-50"><X className="size-4" /></button></div>
      <div className="mt-5 space-y-4">
        <SearchableSelect label="Platform" value={draft.platform} onValueChange={(platform) => setDraft((current) => current ? { ...current, platform } : current)} options={PLATFORM_OPTIONS} allowCustom clearable={false} placeholder="Select or type platform" searchPlaceholder="Search or type platform..." />
        <label className="block text-sm font-medium">Profile URL<input required value={draft.profile_url} onChange={(event) => setDraft((current) => current ? { ...current, profile_url: event.target.value } : current)} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-neutral-500" placeholder="https://www.fiverr.com/username" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Username / handle<input value={draft.username_handle} onChange={(event) => setDraft((current) => current ? { ...current, username_handle: event.target.value } : current)} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-neutral-500" placeholder="@username" /></label><label className="block text-sm font-medium">Display label<input value={draft.label} onChange={(event) => setDraft((current) => current ? { ...current, label: event.target.value } : current)} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-neutral-500" placeholder="Main Fiverr profile" /></label></div>
        <label className="block text-sm font-medium">Notes<textarea value={draft.notes} onChange={(event) => setDraft((current) => current ? { ...current, notes: event.target.value } : current)} className="mt-2 min-h-24 w-full rounded-xl border px-3 py-3 outline-none focus:border-neutral-500" placeholder="Optional context about this profile" /></label>
      </div>
      <div className="mt-6 flex justify-end gap-2 border-t pt-5"><button type="button" disabled={Boolean(working)} onClick={() => setDraft(null)} className="h-10 rounded-xl border px-4 text-sm font-medium disabled:opacity-50">Cancel</button><button disabled={Boolean(working)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{working ? <Loader2 className="size-4 animate-spin" /> : null}{draft.id ? "Save changes" : "Add profile"}</button></div>
    </form></div> : null}
  </section>;
}
