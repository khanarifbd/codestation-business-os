"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Plus, Search, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import { COUNTRY_OPTIONS, CURRENCY_OPTIONS } from "@/lib/company-options";

type Client = {
  id: string;
  client_code: string;
  client_type: string;
  display_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  country_code: string | null;
  currency: string | null;
  status: string;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  created_at: string;
  updated_at: string;
};

const inputClass = "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
const textareaClass = "mt-2 min-h-24 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";

function text(form: FormData, key: string) {
  const value = String(form.get(key) ?? "").trim();
  return value || null;
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`/api/crm${path}`, init);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Authentication required");
    }
    if (response.status === 403) {
      throw new Error("Your company role does not have permission for clients.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.detail ?? "Client request failed.");
    return payload;
  }, [router]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", "30");
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    return params.toString();
  }, [search, statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api(`/clients?${queryString}`) as { items: Client[]; next_cursor: string | null };
      setClients(payload.items);
      setNextCursor(payload.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load clients.");
    } finally {
      setLoading(false);
    }
  }, [api, queryString]);

  useEffect(() => { void load(); }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(queryString);
      params.set("cursor", nextCursor);
      const payload = await api(`/clients?${params.toString()}`) as { items: Client[]; next_cursor: string | null };
      setClients((current) => [...current, ...payload.items]);
      setNextCursor(payload.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load more clients.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api("/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_type: text(form, "client_type") ?? "company",
          display_name: text(form, "display_name"),
          legal_name: text(form, "legal_name"),
          contact_name: text(form, "contact_name"),
          email: text(form, "email"),
          billing_email: text(form, "billing_email"),
          phone: text(form, "phone"),
          whatsapp: text(form, "whatsapp"),
          website: text(form, "website"),
          country_code: text(form, "country_code"),
          state_region: text(form, "state_region"),
          city: text(form, "city"),
          postal_code: text(form, "postal_code"),
          address_line1: text(form, "address_line1"),
          address_line2: text(form, "address_line2"),
          tax_identifier: text(form, "tax_identifier"),
          currency: text(form, "currency"),
          notes: text(form, "notes"),
        }),
      });
      formElement.reset();
      setCreateOpen(false);
      setMessage("Client created");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create client.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(client: Client) {
    setSaving(true);
    setError(null);
    try {
      await api(`/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: client.status === "active" ? "inactive" : "active" }),
      });
      setMessage(client.status === "active" ? "Client marked inactive" : "Client reactivated");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Business relationships</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Clients</h1>
            <p className="mt-2 text-sm text-neutral-500">Master client records used by quotations, orders, projects, invoices and payments.</p>
          </div>
          <button onClick={() => setCreateOpen(true)} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"><Plus className="size-4" /> Add client</button>
        </header>

        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          <Stat label="Loaded clients" value={clients.length} icon={Building2} />
          <Stat label="Active in current page" value={clients.filter((item) => item.status === "active").length} icon={UserRound} />
          <Stat label="More records" value={nextCursor ? "Available" : "No"} icon={Search} />
        </div>

        {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-[minmax(260px,1fr)_220px_auto]">
              <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }} className="relative">
                <Search className="absolute left-3 top-3.5 size-4 text-neutral-400" />
                <input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} placeholder="Search client code, name, email, phone..." className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500" />
              </form>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-11 rounded-xl border bg-white px-3 text-sm"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
              <button type="button" onClick={() => { setSearchDraft(""); setSearch(""); setStatusFilter(""); }} className="h-11 rounded-xl border px-4 text-sm font-medium hover:bg-neutral-50">Reset</button>
            </div>
          </div>

          {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="size-6 animate-spin text-neutral-400" /></div> : clients.length === 0 ? (
            <div className="px-6 py-20 text-center"><Building2 className="mx-auto size-8 text-neutral-300" /><h2 className="mt-4 font-semibold">No clients found</h2><p className="mt-1 text-sm text-neutral-500">Convert a CRM lead or create a client directly.</p></div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[950px] text-left text-sm">
                  <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-400"><tr><th className="px-6 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Contact</th><th className="px-4 py-3 font-medium">Country</th><th className="px-4 py-3 font-medium">Assigned</th><th className="px-4 py-3 font-medium">Status</th><th className="px-6 py-3 text-right font-medium">Action</th></tr></thead>
                  <tbody className="divide-y">{clients.map((client) => <tr key={client.id} className="hover:bg-neutral-50/70"><td className="px-6 py-4"><p className="font-medium">{client.display_name}</p><p className="mt-1 text-xs text-neutral-400">{client.client_code} · {client.client_type}</p></td><td className="px-4 py-4"><p>{client.contact_name ?? "—"}</p><p className="mt-1 text-xs text-neutral-400">{client.email ?? client.phone ?? "No contact"}</p></td><td className="px-4 py-4">{client.country_code ?? "—"}{client.currency ? ` · ${client.currency}` : ""}</td><td className="px-4 py-4">{client.assigned_employee_name ?? "Unassigned"}</td><td className="px-4 py-4"><span className={`rounded-full border px-2.5 py-1 text-xs capitalize ${client.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-neutral-50 text-neutral-500"}`}>{client.status}</span></td><td className="px-6 py-4 text-right"><button disabled={saving} onClick={() => void changeStatus(client)} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-white">{client.status === "active" ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody>
                </table>
              </div>
              {nextCursor ? <div className="border-t p-4 text-center"><button disabled={loadingMore} onClick={() => void loadMore()} className="rounded-xl border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? "Loading..." : "Load more"}</button></div> : null}
            </>
          )}
        </section>
      </div>

      {createOpen ? <Modal title="Add client" onClose={() => setCreateOpen(false)}><form onSubmit={createClient} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Select label="Client type" name="client_type" options={[["company", "Company"], ["individual", "Individual"]]} defaultValue="company" /><Field label="Display name" name="display_name" required /><Field label="Legal name" name="legal_name" /><Field label="Contact person" name="contact_name" /><Field label="Email" name="email" type="email" /><Field label="Billing email" name="billing_email" type="email" /><Field label="Phone" name="phone" /><Field label="WhatsApp" name="whatsapp" /><Field label="Website" name="website" type="url" /><SearchableSelect label="Country" name="country_code" options={COUNTRY_OPTIONS} searchPlaceholder="Search country..." /><SearchableSelect label="Currency" name="currency" options={CURRENCY_OPTIONS} searchPlaceholder="Search currency..." /><Field label="Tax / VAT identifier" name="tax_identifier" /><Field label="State / Province / Region" name="state_region" /><Field label="City" name="city" /><Field label="Postal / ZIP code" name="postal_code" /><div className="sm:col-span-2"><Field label="Address line 1" name="address_line1" /></div><div className="sm:col-span-2"><Field label="Address line 2" name="address_line2" /></div></div><label className="block text-sm font-medium">Notes<textarea name="notes" className={textareaClass} /></label><div className="flex justify-end gap-2 border-t pt-5"><button type="button" onClick={() => setCreateOpen(false)} className="h-11 rounded-xl border px-4 text-sm font-semibold">Cancel</button><button disabled={saving} className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create client</button></div></form></Modal> : null}
    </main>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number | string; icon: typeof Building2 }) { return <article className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-neutral-500">{label}</p><Icon className="size-4 text-neutral-400" /></div><p className="mt-4 text-2xl font-semibold">{value}</p></article>; }
function Field({ label, name, type = "text", required = false }: { label: string; name: string; type?: string; required?: boolean }) { return <label className="block text-sm font-medium">{label}<input name={name} type={type} required={required} className={inputClass} /></label>; }
function Select({ label, name, options, defaultValue = "" }: { label: string; name: string; options: Array<[string, string]>; defaultValue?: string }) { return <label className="block text-sm font-medium">{label}<select name={name} defaultValue={defaultValue} className={inputClass}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose} className="flex size-10 items-center justify-center rounded-xl border"><X className="size-4" /></button></div><div className="p-6">{children}</div></div></div>; }
