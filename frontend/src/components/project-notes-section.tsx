"use client";

import { Check, Copy, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ProjectNote = {
  id: string;
  title: string;
  content: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type NoteDraft = { title: string; content: string };

const emptyDraft: NoteDraft = { title: "", content: "" };
const urlPattern = /(https?:\/\/[^\s]+)/g;

export function ProjectNotesSection({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectNote | null>(null);
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft);
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/notes`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load project notes.");
      setNotes(payload as ProjectNote[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load project notes.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [notes],
  );

  function openCreate() {
    setEditing(null);
    setDraft(emptyDraft);
    setError(null);
    setMessage(null);
    setModalOpen(true);
  }

  function openEdit(note: ProjectNote) {
    setEditing(note);
    setDraft({ title: note.title, content: note.content });
    setError(null);
    setMessage(null);
    setModalOpen(true);
  }

  async function save() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (!title || !content) {
      setError("Note title and content are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const path = editing
        ? `/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(editing.id)}`
        : `/api/projects/${encodeURIComponent(projectId)}/notes`;
      const response = await fetch(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save project note.");
      setModalOpen(false);
      setEditing(null);
      setDraft(emptyDraft);
      setMessage(editing ? "Project note updated." : "Project note added.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save project note.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(note: ProjectNote) {
    if (!window.confirm(`Delete note “${note.title}”? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to delete project note.");
      }
      setMessage("Project note deleted.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete project note.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1600);
    } catch {
      setError("Unable to copy note content.");
    }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold">Project Notes</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">Keep project-specific operational facts such as the live project URL, App Store or Play Store URL, deployment references, handoff details and other links or notes that belong to this project.</p>
      </div>
      {canManage ? <button onClick={openCreate} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" />Add note</button> : null}
    </div>

    {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
    {error && !modalOpen ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

    {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : sortedNotes.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{sortedNotes.map((note) => <article key={note.id} className="rounded-2xl border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="font-semibold text-neutral-900">{note.title}</h3><p className="mt-1 text-xs text-neutral-400">Updated {new Date(note.updated_at).toLocaleString()}</p></div>
        <div className="flex shrink-0 gap-1">
          <button title="Copy note" onClick={() => void copy(note.content, note.id)} className="flex size-9 items-center justify-center rounded-lg border text-neutral-500 hover:bg-neutral-50">{copied === note.id ? <Check className="size-4" /> : <Copy className="size-4" />}</button>
          {canManage ? <><button title="Edit note" onClick={() => openEdit(note)} className="flex size-9 items-center justify-center rounded-lg border text-neutral-500 hover:bg-neutral-50"><Pencil className="size-4" /></button><button title="Delete note" disabled={saving} onClick={() => void remove(note)} className="flex size-9 items-center justify-center rounded-lg border text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="size-4" /></button></> : null}
        </div>
      </div>
      <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-700"><RichText value={note.content} /></div>
    </article>)}</div> : <div className="mt-5 rounded-2xl border border-dashed px-6 py-14 text-center"><p className="font-medium text-neutral-700">No project notes yet</p><p className="mt-1 text-sm text-neutral-400">Add URLs, store links, deployment details or other project-specific references here.</p></div>}

    {modalOpen ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModalOpen(false); }}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4 sm:px-6"><div><h3 className="text-lg font-semibold">{editing ? "Edit project note" : "Add project note"}</h3><p className="mt-1 text-xs text-neutral-400">Project-level information only. Client-wide facts should stay in Client Notes.</p></div><button disabled={saving} onClick={() => setModalOpen(false)} className="flex size-9 items-center justify-center rounded-xl border disabled:opacity-50"><X className="size-4" /></button></div>
        <div className="space-y-4 p-5 sm:p-6">
          {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          <label className="block text-sm font-medium text-neutral-700">Title<input maxLength={180} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Production URL / App Store URL" className="mt-2 h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-neutral-500" /></label>
          <label className="block text-sm font-medium text-neutral-700">Content<textarea maxLength={20000} value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} placeholder="https://example.com or any project-specific note..." className="mt-2 min-h-40 w-full rounded-xl border px-3 py-3 text-sm outline-none focus:border-neutral-500" /></label>
          <div className="flex justify-end gap-2 border-t pt-4"><button disabled={saving} onClick={() => setModalOpen(false)} className="h-10 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50">Cancel</button><button disabled={saving || !draft.title.trim() || !draft.content.trim()} onClick={() => void save()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="size-4 animate-spin" /> : null}{saving ? "Saving…" : editing ? "Save changes" : "Add note"}</button></div>
        </div>
      </div>
    </div> : null}
  </section>;
}

function RichText({ value }: { value: string }) {
  const parts = value.split(urlPattern);
  return <>{parts.map((part, index) => part.match(/^https?:\/\//) ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-blue-600 hover:underline">{part}<ExternalLink className="inline size-3 shrink-0" /></a> : <span key={index}>{part}</span>)}</>;
}
