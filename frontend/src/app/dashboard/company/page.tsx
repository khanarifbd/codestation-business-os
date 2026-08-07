"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  FileText,
  Globe2,
  Landmark,
  Link2,
  Loader2,
  MapPin,
  Palette,
  Phone,
  ReceiptText,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";

type CompanyBundle = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    country_code: string;
    timezone: string;
    currency: string;
    business_type: string | null;
    team_size: string | null;
    financial_year_start_month: number;
  };
  profile: Record<string, string | null> & { incorporation_date: string | null };
  identifiers: Array<{
    id: string;
    identifier_type: string;
    label: string;
    value: string;
    country_code: string | null;
    issuing_authority: string | null;
    issue_date: string | null;
    expiry_date: string | null;
    is_primary: boolean;
  }>;
  addresses: Array<{
    id: string;
    address_type: string;
    recipient_name: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state_region: string | null;
    postal_code: string | null;
    country_code: string | null;
  }>;
  localization: {
    default_language: string;
    date_format: string;
    time_format: string;
    number_format: string;
    decimal_places: number;
    currency_position: string;
    first_day_of_week: number;
  };
  financial: {
    accounting_currency: string;
    default_payment_terms_days: number;
    tax_calculation_mode: string;
    default_tax_rate: string | number;
    prices_include_tax: boolean;
  };
  sequences: Array<{
    id: string;
    document_type: string;
    prefix: string;
    next_number: number;
    padding: number;
    separator: string;
  }>;
  branding: {
    logo_url: string | null;
    square_icon_url: string | null;
    invoice_logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    document_footer: string | null;
  };
  online_legal: {
    privacy_policy_url: string | null;
    terms_url: string | null;
    linkedin_url: string | null;
    facebook_url: string | null;
    x_url: string | null;
    instagram_url: string | null;
    youtube_url: string | null;
  };
  documents: Array<{
    id: string;
    document_type: string;
    title: string;
    document_number: string | null;
    issuing_authority: string | null;
    issue_date: string | null;
    expiry_date: string | null;
    file_url: string | null;
    notes: string | null;
  }>;
};

const tabs = [
  ["general", "General", Building2],
  ["legal", "Legal & IDs", BadgeCheck],
  ["contact", "Contact", Phone],
  ["addresses", "Addresses", MapPin],
  ["localization", "Localization", Globe2],
  ["finance", "Finance & Tax", Landmark],
  ["numbering", "Numbering", ReceiptText],
  ["branding", "Branding", Palette],
  ["documents", "Documents", FileText],
  ["online", "Online & Legal", Link2],
] as const;

type TabId = (typeof tabs)[number][0];

function text(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "").trim();
  return value || null;
}

function inputClass() {
  return "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500";
}

function textareaClass() {
  return "mt-2 min-h-28 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm outline-none transition focus:border-neutral-500";
}

export default function CompanySettingsPage() {
  const router = useRouter();
  const [bundle, setBundle] = useState<CompanyBundle | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch("/api/company-settings", { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (response.status === 403) {
      router.replace("/dashboard");
      return;
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to load company settings.");
      setLoading(false);
      return;
    }
    setBundle((await response.json()) as CompanyBundle);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function api(path: string, method: string, body?: unknown) {
    const response = await fetch(`/api/company-settings${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail ?? "Unable to save changes.");
    }
    return response.status === 204 ? null : response.json();
  }

  async function runSave(work: () => Promise<void>, success = "Changes saved") {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      await load();
      setVersion((value) => value + 1);
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100">
        <Loader2 className="size-6 animate-spin text-neutral-500" />
      </main>
    );
  }

  if (!bundle) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 px-6">
        <div className="max-w-lg rounded-2xl border bg-white p-8 text-center">
          <h1 className="text-xl font-semibold">Company settings unavailable</h1>
          <p className="mt-2 text-sm text-neutral-500">{error}</p>
        </div>
      </main>
    );
  }

  const company = bundle.organization;
  const profile = bundle.profile;
  const addressByType = Object.fromEntries(bundle.addresses.map((item) => [item.address_type, item]));

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-950">
      <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex flex-col gap-4 rounded-2xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="flex size-10 items-center justify-center rounded-xl border hover:bg-neutral-50"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-400">Company master setup</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{company.name}</h1>
              <p className="mt-1 text-sm text-neutral-500">International business identity, localization, finance and document defaults.</p>
            </div>
          </div>
          <div className="rounded-full border bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-600">
            Tenant ID · {company.id.slice(0, 8)}…
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border bg-white p-3 shadow-sm lg:sticky lg:top-5">
            {tabs.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  setMessage(null);
                  setError(null);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  activeTab === id
                    ? "bg-neutral-950 font-medium text-white"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </aside>

          <section className="min-w-0 rounded-2xl border bg-white shadow-sm">
            <div className="border-b px-6 py-5">
              <div className="flex items-center gap-2">
                <Settings2 className="size-4 text-neutral-400" />
                <h2 className="font-semibold">{tabs.find(([id]) => id === activeTab)?.[1]}</h2>
              </div>
            </div>

            <div className="p-6" key={`${activeTab}-${version}`}>
              {activeTab === "general" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void runSave(async () => {
                      await api("/core", "PATCH", {
                        name: text(form, "name"),
                        business_type: text(form, "business_type"),
                        team_size: text(form, "team_size"),
                      });
                      await api("/profile", "PATCH", {
                        legal_name: text(form, "legal_name"),
                        trading_name: text(form, "trading_name"),
                        industry: text(form, "industry"),
                        company_size: text(form, "company_size"),
                        incorporation_date: text(form, "incorporation_date"),
                        website: text(form, "website"),
                        description: text(form, "description"),
                        internal_notes: text(form, "internal_notes"),
                      });
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Display name" name="name" defaultValue={company.name} required />
                    <Field label="Legal company name" name="legal_name" defaultValue={profile.legal_name} />
                    <Field label="Trading / DBA name" name="trading_name" defaultValue={profile.trading_name} />
                    <Field label="Business type" name="business_type" defaultValue={company.business_type} placeholder="Software & IT Services" />
                    <Field label="Industry" name="industry" defaultValue={profile.industry} placeholder="Technology" />
                    <Field label="Company size" name="company_size" defaultValue={profile.company_size ?? company.team_size} placeholder="2-5" />
                    <Field label="Incorporation / founded date" name="incorporation_date" type="date" defaultValue={profile.incorporation_date} />
                    <Field label="Website" name="website" type="url" defaultValue={profile.website} placeholder="https://example.com" />
                  </div>
                  <label className="block text-sm font-medium">
                    Company description
                    <textarea name="description" defaultValue={profile.description ?? ""} className={textareaClass()} />
                  </label>
                  <label className="block text-sm font-medium">
                    Internal notes <span className="font-normal text-neutral-400">(never shown on public documents)</span>
                    <textarea name="internal_notes" defaultValue={profile.internal_notes ?? ""} className={textareaClass()} />
                  </label>
                  <SaveBar saving={saving} />
                </form>
              ) : null}

              {activeTab === "contact" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void runSave(async () => {
                      await api("/profile", "PATCH", {
                        primary_email: text(form, "primary_email"),
                        billing_email: text(form, "billing_email"),
                        support_email: text(form, "support_email"),
                        phone: text(form, "phone"),
                        alternate_phone: text(form, "alternate_phone"),
                        whatsapp: text(form, "whatsapp"),
                        fax: text(form, "fax"),
                      });
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Primary email" name="primary_email" type="email" defaultValue={profile.primary_email} />
                    <Field label="Billing email" name="billing_email" type="email" defaultValue={profile.billing_email} />
                    <Field label="Support email" name="support_email" type="email" defaultValue={profile.support_email} />
                    <Field label="Primary phone" name="phone" defaultValue={profile.phone} placeholder="+880..." />
                    <Field label="Alternate phone" name="alternate_phone" defaultValue={profile.alternate_phone} />
                    <Field label="WhatsApp" name="whatsapp" defaultValue={profile.whatsapp} />
                    <Field label="Fax" name="fax" defaultValue={profile.fax} />
                  </div>
                  <SaveBar saving={saving} />
                </form>
              ) : null}

              {activeTab === "legal" ? (
                <div className="space-y-7">
                  <div>
                    <h3 className="text-sm font-semibold">Business identifiers</h3>
                    <p className="mt-1 text-sm text-neutral-500">Use any country-specific identifier: Company No, TIN, BIN, VAT, GST, EIN, ABN, ACN, DUNS or custom.</p>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formElement = event.currentTarget;
                      const form = new FormData(formElement);
                      void runSave(async () => {
                        await api("/identifiers", "POST", {
                          identifier_type: text(form, "identifier_type"),
                          label: text(form, "label"),
                          value: text(form, "value"),
                          country_code: text(form, "country_code"),
                          issuing_authority: text(form, "issuing_authority"),
                          issue_date: text(form, "issue_date"),
                          expiry_date: text(form, "expiry_date"),
                          is_primary: form.get("is_primary") === "on",
                        });
                        formElement.reset();
                      }, "Identifier added");
                    }}
                    className="rounded-2xl border bg-neutral-50 p-5"
                  >
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Type" name="identifier_type" placeholder="tax / vat / ein / abn" required />
                      <Field label="Display label" name="label" placeholder="Tax Identification Number" required />
                      <Field label="Value" name="value" required />
                      <Field label="Country code" name="country_code" placeholder="BD / US / AU" />
                      <Field label="Issuing authority" name="issuing_authority" />
                      <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" name="is_primary" /> Primary identifier</label>
                      <Field label="Issue date" name="issue_date" type="date" />
                      <Field label="Expiry date" name="expiry_date" type="date" />
                    </div>
                    <button disabled={saving} className="mt-5 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Add identifier</button>
                  </form>

                  <div className="divide-y rounded-2xl border">
                    {bundle.identifiers.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{item.label} {item.is_primary ? <span className="ml-2 text-xs text-emerald-600">Primary</span> : null}</p>
                          <p className="mt-1 text-sm text-neutral-500">{item.value} · {item.identifier_type}{item.country_code ? ` · ${item.country_code}` : ""}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runSave(() => api(`/identifiers/${item.id}`, "DELETE").then(() => undefined), "Identifier removed")}
                          className="flex size-9 items-center justify-center rounded-lg border text-neutral-400 hover:text-red-600"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                    {bundle.identifiers.length === 0 ? <p className="p-6 text-sm text-neutral-400">No identifiers added yet.</p> : null}
                  </div>
                </div>
              ) : null}

              {activeTab === "addresses" ? (
                <div className="grid gap-5 xl:grid-cols-2">
                  {(["registered", "office", "billing", "mailing"] as const).map((type) => {
                    const address = addressByType[type];
                    return (
                      <form
                        key={`${type}-${version}`}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          void runSave(async () => {
                            await api(`/addresses/${type}`, "PUT", {
                              recipient_name: text(form, "recipient_name"),
                              line1: text(form, "line1"),
                              line2: text(form, "line2"),
                              city: text(form, "city"),
                              state_region: text(form, "state_region"),
                              postal_code: text(form, "postal_code"),
                              country_code: text(form, "country_code"),
                            });
                          }, `${type[0].toUpperCase() + type.slice(1)} address saved`);
                        }}
                        className="rounded-2xl border p-5"
                      >
                        <h3 className="font-semibold capitalize">{type} address</h3>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <Field label="Recipient / company" name="recipient_name" defaultValue={address?.recipient_name} />
                          <Field label="Country code" name="country_code" defaultValue={address?.country_code ?? company.country_code} />
                          <div className="sm:col-span-2"><Field label="Address line 1" name="line1" defaultValue={address?.line1} /></div>
                          <div className="sm:col-span-2"><Field label="Address line 2" name="line2" defaultValue={address?.line2} /></div>
                          <Field label="City" name="city" defaultValue={address?.city} />
                          <Field label="State / Province / Region" name="state_region" defaultValue={address?.state_region} />
                          <Field label="Postal / ZIP code" name="postal_code" defaultValue={address?.postal_code} />
                        </div>
                        <button disabled={saving} className="mt-5 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-neutral-50">Save address</button>
                      </form>
                    );
                  })}
                </div>
              ) : null}

              {activeTab === "localization" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void runSave(async () => {
                      await api("/localization", "PATCH", {
                        country_code: text(form, "country_code"),
                        timezone: text(form, "timezone"),
                        currency: text(form, "currency"),
                        default_language: text(form, "default_language"),
                        date_format: text(form, "date_format"),
                        time_format: text(form, "time_format"),
                        number_format: text(form, "number_format"),
                        decimal_places: Number(form.get("decimal_places")),
                        currency_position: text(form, "currency_position"),
                        first_day_of_week: Number(form.get("first_day_of_week")),
                      });
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    <Field label="Country (ISO-2)" name="country_code" defaultValue={company.country_code} required />
                    <Field label="Timezone (IANA)" name="timezone" defaultValue={company.timezone} required />
                    <Field label="Base currency (ISO-3)" name="currency" defaultValue={company.currency} required />
                    <Field label="Default language" name="default_language" defaultValue={bundle.localization.default_language} required />
                    <Field label="Date format" name="date_format" defaultValue={bundle.localization.date_format} required />
                    <SelectField label="Time format" name="time_format" defaultValue={bundle.localization.time_format} options={["24h", "12h"]} />
                    <Field label="Number format" name="number_format" defaultValue={bundle.localization.number_format} required />
                    <Field label="Decimal places" name="decimal_places" type="number" defaultValue={String(bundle.localization.decimal_places)} required />
                    <SelectField label="Currency position" name="currency_position" defaultValue={bundle.localization.currency_position} options={["before", "after"]} />
                    <SelectField label="First day of week" name="first_day_of_week" defaultValue={String(bundle.localization.first_day_of_week)} options={["0", "1", "2", "3", "4", "5", "6"]} />
                  </div>
                  <SaveBar saving={saving} />
                </form>
              ) : null}

              {activeTab === "finance" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void runSave(async () => {
                      await api("/financial", "PATCH", {
                        financial_year_start_month: Number(form.get("financial_year_start_month")),
                        accounting_currency: text(form, "accounting_currency"),
                        default_payment_terms_days: Number(form.get("default_payment_terms_days")),
                        tax_calculation_mode: text(form, "tax_calculation_mode"),
                        default_tax_rate: Number(form.get("default_tax_rate")),
                        prices_include_tax: form.get("prices_include_tax") === "on",
                      });
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    <SelectField label="Financial year starts" name="financial_year_start_month" defaultValue={String(company.financial_year_start_month)} options={Array.from({ length: 12 }, (_, i) => String(i + 1))} />
                    <Field label="Accounting currency" name="accounting_currency" defaultValue={bundle.financial.accounting_currency} required />
                    <Field label="Default payment terms (days)" name="default_payment_terms_days" type="number" defaultValue={String(bundle.financial.default_payment_terms_days)} required />
                    <SelectField label="Tax calculation" name="tax_calculation_mode" defaultValue={bundle.financial.tax_calculation_mode} options={["exclusive", "inclusive"]} />
                    <Field label="Default tax rate %" name="default_tax_rate" type="number" step="0.0001" defaultValue={String(bundle.financial.default_tax_rate)} required />
                    <label className="flex items-end gap-2 pb-3 text-sm font-medium"><input type="checkbox" name="prices_include_tax" defaultChecked={bundle.financial.prices_include_tax} /> Prices include tax by default</label>
                  </div>
                  <SaveBar saving={saving} />
                </form>
              ) : null}

              {activeTab === "numbering" ? (
                <div className="space-y-4">
                  <p className="text-sm text-neutral-500">Tenant-scoped numbering keeps invoices, quotations, orders, projects, clients and employees independent per company.</p>
                  {bundle.sequences.map((sequence) => (
                    <form
                      key={`${sequence.id}-${version}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void runSave(async () => {
                          await api(`/sequences/${sequence.document_type}`, "PUT", {
                            prefix: text(form, "prefix"),
                            next_number: Number(form.get("next_number")),
                            padding: Number(form.get("padding")),
                            separator: String(form.get("separator") ?? "-"),
                          });
                        }, `${sequence.document_type} numbering saved`);
                      }}
                      className="grid items-end gap-4 rounded-2xl border p-4 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto]"
                    >
                      <div><p className="pb-3 text-sm font-semibold capitalize">{sequence.document_type}</p></div>
                      <Field label="Prefix" name="prefix" defaultValue={sequence.prefix} required />
                      <Field label="Next number" name="next_number" type="number" defaultValue={String(sequence.next_number)} required />
                      <Field label="Padding" name="padding" type="number" defaultValue={String(sequence.padding)} required />
                      <Field label="Separator" name="separator" defaultValue={sequence.separator} required />
                      <button disabled={saving} className="h-11 rounded-xl border px-4 text-sm font-semibold hover:bg-neutral-50">Save</button>
                    </form>
                  ))}
                </div>
              ) : null}

              {activeTab === "branding" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void runSave(async () => {
                      await api("/branding", "PATCH", {
                        logo_url: text(form, "logo_url"),
                        square_icon_url: text(form, "square_icon_url"),
                        invoice_logo_url: text(form, "invoice_logo_url"),
                        primary_color: text(form, "primary_color"),
                        secondary_color: text(form, "secondary_color"),
                        document_footer: text(form, "document_footer"),
                      });
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Company logo URL" name="logo_url" type="url" defaultValue={bundle.branding.logo_url} />
                    <Field label="Square icon URL" name="square_icon_url" type="url" defaultValue={bundle.branding.square_icon_url} />
                    <Field label="Invoice logo URL" name="invoice_logo_url" type="url" defaultValue={bundle.branding.invoice_logo_url} />
                    <Field label="Primary color" name="primary_color" defaultValue={bundle.branding.primary_color} placeholder="#111111" />
                    <Field label="Secondary color" name="secondary_color" defaultValue={bundle.branding.secondary_color} placeholder="#666666" />
                  </div>
                  <label className="block text-sm font-medium">Document / invoice footer<textarea name="document_footer" defaultValue={bundle.branding.document_footer ?? ""} className={textareaClass()} /></label>
                  <p className="text-xs text-neutral-400">Binary logo upload will use object storage later; these fields already match that storage URL contract.</p>
                  <SaveBar saving={saving} />
                </form>
              ) : null}

              {activeTab === "documents" ? (
                <div className="space-y-6">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const formElement = event.currentTarget;
                      const form = new FormData(formElement);
                      void runSave(async () => {
                        await api("/documents", "POST", {
                          document_type: text(form, "document_type"),
                          title: text(form, "title"),
                          document_number: text(form, "document_number"),
                          issuing_authority: text(form, "issuing_authority"),
                          issue_date: text(form, "issue_date"),
                          expiry_date: text(form, "expiry_date"),
                          file_url: text(form, "file_url"),
                          notes: text(form, "notes"),
                        });
                        formElement.reset();
                      }, "Document added");
                    }}
                    className="rounded-2xl border bg-neutral-50 p-5"
                  >
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Document type" name="document_type" placeholder="trade_license / tax_certificate" required />
                      <Field label="Title" name="title" required />
                      <Field label="Document number" name="document_number" />
                      <Field label="Issuing authority" name="issuing_authority" />
                      <Field label="Issue date" name="issue_date" type="date" />
                      <Field label="Expiry date" name="expiry_date" type="date" />
                      <div className="md:col-span-2"><Field label="File URL / storage reference" name="file_url" type="url" /></div>
                      <Field label="Notes" name="notes" />
                    </div>
                    <button disabled={saving} className="mt-5 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Add document</button>
                  </form>
                  <div className="divide-y rounded-2xl border">
                    {bundle.documents.map((document) => (
                      <div key={document.id} className="flex items-center justify-between gap-4 p-4">
                        <div>
                          <p className="font-medium">{document.title}</p>
                          <p className="mt-1 text-sm text-neutral-500">{document.document_type}{document.document_number ? ` · ${document.document_number}` : ""}{document.expiry_date ? ` · expires ${document.expiry_date}` : ""}</p>
                        </div>
                        <button type="button" onClick={() => void runSave(() => api(`/documents/${document.id}`, "DELETE").then(() => undefined), "Document removed")} className="flex size-9 items-center justify-center rounded-lg border text-neutral-400 hover:text-red-600"><Trash2 className="size-4" /></button>
                      </div>
                    ))}
                    {bundle.documents.length === 0 ? <p className="p-6 text-sm text-neutral-400">No company documents added yet.</p> : null}
                  </div>
                </div>
              ) : null}

              {activeTab === "online" ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void runSave(async () => {
                      await api("/online-legal", "PATCH", {
                        privacy_policy_url: text(form, "privacy_policy_url"),
                        terms_url: text(form, "terms_url"),
                        linkedin_url: text(form, "linkedin_url"),
                        facebook_url: text(form, "facebook_url"),
                        x_url: text(form, "x_url"),
                        instagram_url: text(form, "instagram_url"),
                        youtube_url: text(form, "youtube_url"),
                      });
                    });
                  }}
                  className="space-y-6"
                >
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Privacy Policy URL" name="privacy_policy_url" type="url" defaultValue={bundle.online_legal.privacy_policy_url} />
                    <Field label="Terms & Conditions URL" name="terms_url" type="url" defaultValue={bundle.online_legal.terms_url} />
                    <Field label="LinkedIn" name="linkedin_url" type="url" defaultValue={bundle.online_legal.linkedin_url} />
                    <Field label="Facebook" name="facebook_url" type="url" defaultValue={bundle.online_legal.facebook_url} />
                    <Field label="X / Twitter" name="x_url" type="url" defaultValue={bundle.online_legal.x_url} />
                    <Field label="Instagram" name="instagram_url" type="url" defaultValue={bundle.online_legal.instagram_url} />
                    <Field label="YouTube" name="youtube_url" type="url" defaultValue={bundle.online_legal.youtube_url} />
                  </div>
                  <SaveBar saving={saving} />
                </form>
              ) : null}

              {message ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
              {error ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  required = false,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
        step={step}
        className={inputClass()}
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  options,
}: {
  label: string;
  name: string;
  defaultValue: string;
  options: string[];
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <select name={name} defaultValue={defaultValue} className={inputClass()}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function SaveBar({ saving }: { saving: boolean }) {
  return (
    <div className="flex justify-end border-t pt-5">
      <button
        type="submit"
        disabled={saving}
        className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        Save changes
      </button>
    </div>
  );
}
