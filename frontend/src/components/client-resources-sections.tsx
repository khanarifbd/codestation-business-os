"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type ClientNote = {
  id: string;
  title: string;
  content: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type ClientDocument = {
  id: string;
  title: string;
  document_type: string;
  original_filename: string;
  content_type: string | null;
  size_bytes: number;
  notes: string | null;
  uploaded_by_user_id: string;
  created_at: string;
};

type ClientCredential = {
  id: string;
  name: string;
  credential_type: string;
  environment: string;
  username: string | null;
  url: string | null;
  notes: string | null;
  access_level: string;
  created_by_user_id: string;
  last_revealed_by: string | null;
  last_revealed_at: string | null;
  created_at: string;
  updated_at: string;
};

type CredentialForm = {
  name: string;
  credential_type: string;
  environment: string;
  username: string;
  secret: string;
  url: string;
  notes: string;
  access_level: string;
};

const blankCredential: CredentialForm = {
  name: "",
  credential_type: "login",
  environment: "production",
  username: "",
  secret: "",
  url: "",
  notes: "",
  access_level: "manager_only",
};

function pretty(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function dateTime(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail ?? "Request failed.");
  return payload;
}

function vaultMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Credential request failed.";
  if (message.toLowerCase().includes("credentials vault") || message.toLowerCase().includes("encryption key")) {
    return "Credentials Vault is temporarily unavailable. Please contact your administrator.";
  }
  return message;
}

export function ClientNotesSection({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const [items, setItems] = useState<ClientNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<ClientNote | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setItems(await api(`/api/crm/clients/${encodeURIComponent(clientId)}/notes`) as ClientNote[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load client notes.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setSelected(null); setTitle(""); setContent(""); setError(null); setModal(true);
  }

  function openEdit(item: ClientNote) {
    setSelected(item); setTitle(item.title); setContent(item.content); setError(null); setModal(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const path = selected
        ? `/api/crm/clients/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(selected.id)}`
        : `/api/crm/clients/${encodeURIComponent(clientId)}/notes`;
      await api(path, {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      setModal(false); setMessage(selected ? "Client note updated." : "Client note added."); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save client note.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: ClientNote) {
    if (!window.confirm(`Delete note “${item.title}”?`)) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      await api(`/api/crm/clients/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setMessage("Client note deleted."); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete client note.");
    } finally {
      setSaving(false);
    }
  }

  return <Panel
    icon={StickyNote}
    title="Client Notes"
    description="Keep reusable client-level operational notes such as Lovable workspace names, developer account names, handoff details or other small facts that are not specific to one project."
    action={canManage ? <PrimaryButton onClick={openCreate}><Plus className="size-4" />Add note</PrimaryButton> : null}
  >
    <Notices error={error} message={message} />
    {loading ? <Loading /> : items.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="rounded-2xl border bg-neutral-50 p-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-neutral-400">Updated {dateTime(item.updated_at)}</p></div>{canManage ? <div className="flex gap-1"><IconButton title="Edit note" onClick={() => openEdit(item)}><Pencil className="size-4" /></IconButton><IconButton title="Delete note" danger onClick={() => void remove(item)}><Trash2 className="size-4" /></IconButton></div> : null}</div>
      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-600">{item.content}</p>
    </article>)}</div> : <Empty text="No client-level notes yet." />}

    {modal ? <Modal title={selected ? "Edit client note" : "Add client note"} onClose={() => setModal(false)}>
      <form onSubmit={save} className="space-y-4">
        {error ? <ErrorBox text={error} /> : null}
        <Field label="Title"><input required maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Apple Developer account name" /></Field>
        <Field label="Note"><textarea required rows={7} maxLength={20000} value={content} onChange={(e) => setContent(e.target.value)} className="textarea" placeholder="Client-wide information that may be useful across projects..." /></Field>
        <button disabled={saving} className="btn-primary w-full">{saving ? "Saving..." : selected ? "Save changes" : "Add note"}</button>
      </form>
    </Modal> : null}
  </Panel>;
}

export function ClientDocumentsSection({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const [items, setItems] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("other");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setItems(await api(`/api/crm/clients/${encodeURIComponent(clientId)}/documents`) as ClientDocument[]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load client documents.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  function openUpload() {
    setTitle(""); setDocumentType("other"); setNotes(""); setFile(null); setError(null); setModal(true);
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) { setError("Select a file first."); return; }
    const form = new FormData();
    form.append("file", file); form.append("title", title); form.append("document_type", documentType);
    if (notes.trim()) form.append("notes", notes.trim());
    setSaving(true); setError(null); setMessage(null);
    try {
      await api(`/api/crm/clients/${encodeURIComponent(clientId)}/documents/upload`, { method: "POST", body: form });
      setModal(false); setMessage("Client document uploaded securely."); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload client document.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: ClientDocument) {
    if (!window.confirm(`Delete document “${item.title}”?`)) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      await api(`/api/crm/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setMessage("Client document deleted."); await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete client document.");
    } finally {
      setSaving(false);
    }
  }

  return <Panel
    icon={FileText}
    title="Client Documents"
    description="Store documents that belong to the client relationship across projects. Project-only files should remain inside the relevant project."
    action={canManage ? <PrimaryButton onClick={openUpload}><Upload className="size-4" />Upload document</PrimaryButton> : null}
  >
    <Notices error={error} message={message} />
    {loading ? <Loading /> : items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wide text-neutral-400"><tr><th className="pb-3 font-medium">Document</th><th className="pb-3 font-medium">Type</th><th className="pb-3 font-medium">Size</th><th className="pb-3 font-medium">Uploaded</th><th className="pb-3 text-right font-medium">Actions</th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id}><td className="py-4"><p className="font-semibold">{item.title}</p><p className="mt-1 text-xs text-neutral-400">{item.original_filename}{item.notes ? ` · ${item.notes}` : ""}</p></td><td>{pretty(item.document_type)}</td><td>{fileSize(item.size_bytes)}</td><td>{dateTime(item.created_at)}</td><td><div className="flex justify-end gap-2"><button type="button" onClick={() => window.open(`/api/crm/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(item.id)}/preview`, "_blank", "noopener,noreferrer")} className="rounded-lg border px-3 py-2 text-xs font-semibold">View</button><a href={`/api/crm/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(item.id)}/file`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold"><Download className="size-3.5" />Download</a>{canManage ? <button type="button" disabled={saving} onClick={() => void remove(item)} className="rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-600">Delete</button> : null}</div></td></tr>)}</tbody></table></div> : <Empty text="No client-level documents yet." />}

    {modal ? <Modal title="Upload client document" onClose={() => setModal(false)}>
      <form onSubmit={upload} className="space-y-4">
        {error ? <ErrorBox text={error} /> : null}
        <Field label="Title"><input required maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} className="input" placeholder="Apple Developer agreement" /></Field>
        <Field label="Document type"><input required maxLength={64} value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="input" placeholder="agreement, identity, access, other..." /></Field>
        <Field label="File"><input required type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input py-2" /></Field>
        <Field label="Notes"><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="textarea" /></Field>
        <button disabled={saving || !file} className="btn-primary w-full">{saving ? "Uploading..." : "Upload document"}</button>
      </form>
    </Modal> : null}
  </Panel>;
}

export function ClientCredentialsSection({ clientId, canManage }: { clientId: string; canManage: boolean }) {
  const [items, setItems] = useState<ClientCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<ClientCredential | null>(null);
  const [form, setForm] = useState<CredentialForm>(blankCredential);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setItems(await api(`/api/crm/clients/${encodeURIComponent(clientId)}/credentials`) as ClientCredential[]);
    } catch (reason) {
      setError(vaultMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setSelected(null); setForm(blankCredential); setError(null); setModal(true);
  }

  function openEdit(item: ClientCredential) {
    setSelected(item);
    setForm({
      name: item.name,
      credential_type: item.credential_type,
      environment: item.environment,
      username: item.username ?? "",
      secret: "",
      url: item.url ?? "",
      notes: item.notes ?? "",
      access_level: item.access_level,
    });
    setError(null); setModal(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const payload = {
        name: form.name,
        credential_type: form.credential_type,
        environment: form.environment,
        username: form.username || null,
        ...(form.secret ? { secret: form.secret } : {}),
        url: form.url || null,
        notes: form.notes || null,
        access_level: form.access_level,
      };
      if (!selected && !form.secret) throw new Error("Secret is required for a new credential.");
      const path = selected
        ? `/api/crm/clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(selected.id)}`
        : `/api/crm/clients/${encodeURIComponent(clientId)}/credentials`;
      await api(path, {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setModal(false); setSelected(null); setMessage(selected ? "Credential updated securely." : "Credential encrypted and saved."); await load();
    } catch (reason) {
      setError(vaultMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  async function accessSecret(item: ClientCredential) {
    if (revealed[item.id]) return revealed[item.id];
    const payload = await api(`/api/crm/clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(item.id)}/reveal`, { method: "POST" }) as { secret: string };
    setRevealed((current) => ({ ...current, [item.id]: payload.secret }));
    window.setTimeout(() => setRevealed((current) => { const next = { ...current }; delete next[item.id]; return next; }), 30000);
    await load();
    return payload.secret;
  }

  async function reveal(item: ClientCredential) {
    setError(null); setMessage(null);
    try { await accessSecret(item); }
    catch (reason) { setError(vaultMessage(reason)); }
  }

  function hide(id: string) {
    setRevealed((current) => { const next = { ...current }; delete next[id]; return next; });
  }

  async function copy(value: string, key: string, label: string) {
    try {
      await navigator.clipboard.writeText(value); setCopied(key); setMessage(`${label} copied to clipboard.`);
      window.setTimeout(() => setCopied((current) => current === key ? null : current), 1800);
    } catch {
      setError(`Unable to copy ${label.toLowerCase()}.`);
    }
  }

  async function copySecret(item: ClientCredential) {
    setError(null);
    try { await copy(await accessSecret(item), `secret:${item.id}`, "Secret"); }
    catch (reason) { setError(vaultMessage(reason)); }
  }

  async function remove(item: ClientCredential) {
    if (!window.confirm(`Delete credential “${item.name}”? This cannot be undone.`)) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      await api(`/api/crm/clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      hide(item.id); setMessage("Credential deleted."); await load();
    } catch (reason) {
      setError(vaultMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return <Panel
    icon={KeyRound}
    title="Client Credentials"
    description="Store client-wide credentials that may be reused across multiple projects. Secrets are encrypted at rest and every reveal is recorded in the audit trail."
    action={canManage ? <PrimaryButton onClick={openCreate}><Plus className="size-4" />Add credential</PrimaryButton> : null}
  >
    <Notices error={error} message={message} />
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">Use this vault for credentials owned by the client relationship, such as a shared Apple Developer account. Keep credentials that belong to only one project inside that project.</div>
    {loading ? <Loading /> : items.length ? <div className="grid gap-4 lg:grid-cols-2">{items.map((item) => <article key={item.id} className="rounded-2xl border bg-neutral-50 p-5">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.name}</p><span className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-neutral-500">{pretty(item.access_level)}</span></div><p className="mt-1 text-xs text-neutral-400">{pretty(item.credential_type)} · {pretty(item.environment)}</p></div>{canManage ? <div className="flex gap-1"><IconButton title="Edit credential" onClick={() => openEdit(item)}><Pencil className="size-4" /></IconButton><IconButton title="Delete credential" danger onClick={() => void remove(item)}><Trash2 className="size-4" /></IconButton></div> : null}</div>
      <div className="mt-4 space-y-3 text-sm"><CredentialLine label="Username" value={item.username ?? "—"} action={item.username ? <button type="button" onClick={() => void copy(item.username!, `user:${item.id}`, "Username")} className="text-neutral-400 hover:text-neutral-900"><Copy className="size-4" /></button> : null} /><CredentialLine label="Secret" value={revealed[item.id] ?? "••••••••••••"} action={<div className="flex items-center gap-2"><button type="button" onClick={() => revealed[item.id] ? hide(item.id) : void reveal(item)} className="text-neutral-400 hover:text-neutral-900">{revealed[item.id] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button><button type="button" onClick={() => void copySecret(item)} className="text-neutral-400 hover:text-neutral-900"><Copy className="size-4" /></button></div>} />{item.url ? <CredentialLine label="URL" value={item.url} action={<a href={item.url} target="_blank" rel="noreferrer noopener" className="text-xs font-semibold text-blue-600">Open</a>} /> : null}</div>
      {item.notes ? <p className="mt-4 whitespace-pre-wrap rounded-xl bg-white p-3 text-sm leading-6 text-neutral-600">{item.notes}</p> : null}
      <p className="mt-4 text-xs text-neutral-400">Last revealed {dateTime(item.last_revealed_at)}{item.last_revealed_by ? ` by ${item.last_revealed_by}` : ""}</p>
      {copied === `secret:${item.id}` || copied === `user:${item.id}` ? <p className="mt-1 text-xs text-emerald-600">Copied</p> : null}
    </article>)}</div> : <Empty text={canManage ? "No client-level credentials yet." : "No team-access client credentials are available."} />}

    {modal ? <Modal title={selected ? "Edit client credential" : "Add client credential"} onClose={() => setModal(false)} wide>
      <form onSubmit={save} className="space-y-4">
        {error ? <ErrorBox text={error} /> : null}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><input required maxLength={180} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="Apple Developer Account" /></Field><Field label="Credential type"><input required maxLength={40} value={form.credential_type} onChange={(e) => setForm({ ...form, credential_type: e.target.value })} className="input" placeholder="login, api_key, recovery..." /></Field><Field label="Environment"><input required maxLength={32} value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="input" placeholder="production" /></Field><Field label="Access"><select value={form.access_level} onChange={(e) => setForm({ ...form, access_level: e.target.value })} className="input"><option value="manager_only">Manager only</option><option value="team">Team</option></select></Field><Field label="Username / Email"><input maxLength={320} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="input" /></Field><Field label={selected ? "New secret (leave blank to keep current)" : "Secret"}><input required={!selected} type="password" maxLength={10000} value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} className="input" autoComplete="new-password" /></Field><Field label="URL" wide><input maxLength={1000} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="input" placeholder="https://developer.apple.com/..." /></Field><Field label="Notes" wide><textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="textarea" /></Field></div>
        <button disabled={saving} className="btn-primary w-full">{saving ? "Saving securely..." : selected ? "Save credential" : "Encrypt and save credential"}</button>
      </form>
    </Modal> : null}
  </Panel>;
}

function Panel({ icon: Icon, title, description, action, children }: { icon: typeof FileText; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><Icon className="size-5 text-neutral-600" /></div><div><h2 className="font-semibold">{title}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">{description}</p></div></div>{action}</div><div className="mt-5">{children}</div><style jsx global>{`.input{height:44px;width:100%;border:1px solid #e5e5e5;border-radius:12px;padding:0 12px;font-size:14px;background:white}.textarea{width:100%;border:1px solid #e5e5e5;border-radius:12px;padding:10px 12px;font-size:14px;background:white}.btn-primary{height:46px;border-radius:12px;background:#0a0a0a;color:white;font-size:14px;font-weight:600}.btn-primary:disabled{opacity:.5}`}</style></section>;
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white">{children}</button>;
}

function IconButton({ title, danger = false, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className={`flex size-9 items-center justify-center rounded-lg border bg-white ${danger ? "text-red-600" : "text-neutral-500"}`}>{children}</button>;
}

function CredentialLine({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-neutral-400">{label}</p><p className="mt-1 break-all font-medium text-neutral-700">{value}</p></div>{action}</div>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`text-sm font-medium text-neutral-600 ${wide ? "sm:col-span-2" : ""}`}><span className="mb-2 block">{label}</span>{children}</label>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"><div className={`max-h-[94vh] w-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`}><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{title}</h3><button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-neutral-100"><X className="size-5" /></button></div><div className="mt-5">{children}</div></div></div>;
}

function Notices({ error, message }: { error: string | null; message: string | null }) {
  return <>{message ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}{error ? <ErrorBox text={error} /> : null}</>;
}

function ErrorBox({ text }: { text: string }) {
  return <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{text}</div>;
}

function Loading() {
  return <div className="flex min-h-40 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="py-12 text-center text-sm text-neutral-400">{text}</div>;
}
