"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, Check, Loader2 } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { SearchableSelect, type SearchOption } from "@/components/searchable-select";
import {
  BUSINESS_TYPE_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  TIMEZONE_OPTIONS,
} from "@/lib/company-options";

const FINANCIAL_YEAR_OPTIONS: SearchOption[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((month, index) => ({ value: String(index + 1), label: month }));

export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/organizations", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.ok) {
        const organizations = (await response.json()) as unknown[];
        if (organizations.length > 0) {
          router.replace("/dashboard");
          return;
        }
      }
      setChecking(false);
    })();
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        country_code: form.get("country_code"),
        timezone: form.get("timezone"),
        currency: form.get("currency"),
        business_type: form.get("business_type"),
        team_size: form.get("team_size"),
        financial_year_start_month: Number(form.get("financial_year_start_month")),
      }),
    });

    if (response.status === 401) {
      router.replace("/login");
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.detail ?? "Unable to create the company workspace.");
      setLoading(false);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50">
        <Loader2 className="size-6 animate-spin text-neutral-500" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-5 py-10 text-neutral-950 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
              <BrandMark className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-sm text-neutral-500">CodeStation AI</p>
              <h1 className="text-xl font-semibold">Business OS</h1>
            </div>
          </div>
          <div className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-neutral-600">
            Company setup
          </div>
        </header>

        <div className="grid overflow-hidden rounded-3xl border bg-white shadow-sm lg:grid-cols-[0.72fr_1.28fr]">
          <aside className="border-b bg-neutral-950 p-8 text-white lg:border-b-0 lg:border-r lg:p-10">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white p-2.5 shadow-lg shadow-black/20">
              <BrandMark className="h-full w-full object-contain" />
            </div>
            <h2 className="mt-8 text-3xl font-semibold tracking-tight">Set up your company.</h2>
            <p className="mt-4 text-sm leading-6 text-white/50">
              These settings create the tenant boundary used by clients, orders, projects, finance, HR, and reports.
            </p>
            <div className="mt-8 space-y-3 text-sm text-white/65">
              {[
                "Private company workspace",
                "Company admin role created automatically",
                "Currency and timezone scoped per company",
                "Ready for team invitations and permissions",
              ].map((item) => (
                <div key={item} className="flex gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </aside>

          <section className="p-7 sm:p-10">
            <div>
              <p className="text-sm font-medium text-neutral-500">Step 1 of 1</p>
              <h2 className="mt-2 text-2xl font-semibold">Company information</h2>
              <p className="mt-2 text-sm text-neutral-500">
                Most settings can be changed later from Company & Settings. Choose the accounting currency carefully before posting financial transactions.
              </p>
            </div>

            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              <label className="block text-sm font-medium">
                Company name
                <input
                  name="name"
                  required
                  minLength={2}
                  autoComplete="organization"
                  className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500"
                  placeholder="Your company name"
                />
              </label>

              <div className="grid gap-5 sm:grid-cols-2">
                <SearchableSelect
                  label="Business type"
                  name="business_type"
                  defaultValue="Software & IT Services"
                  options={BUSINESS_TYPE_OPTIONS}
                  clearable={false}
                  searchPlaceholder="Search business type..."
                />

                <SearchableSelect
                  label="Team size"
                  name="team_size"
                  defaultValue="2-5"
                  options={COMPANY_SIZE_OPTIONS}
                  clearable={false}
                  searchPlaceholder="Search team size..."
                />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold">Important: choose your accounting currency carefully</p>
                    <p className="mt-1 text-sm leading-6 text-amber-900/80">
                      This becomes the base currency for your Journal, Ledger, Trial Balance and financial statements. After accounting entries are posted, changing it requires a controlled currency migration. Choose the currency you actually keep your books in — not simply the currency most clients pay you in.
                    </p>
                    <p className="mt-2 text-xs leading-5 text-amber-800">
                      Reporting currency and default client currency can be configured separately later in Company & Settings → Currencies & FX.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <SearchableSelect
                  label="Country"
                  name="country_code"
                  defaultValue="BD"
                  options={COUNTRY_OPTIONS}
                  required
                  clearable={false}
                  searchPlaceholder="Search country or code..."
                />

                <div>
                  <SearchableSelect
                    label="Accounting / functional currency"
                    name="currency"
                    defaultValue="BDT"
                    options={CURRENCY_OPTIONS}
                    required
                    clearable={false}
                    searchPlaceholder="Search currency or code..."
                  />
                  <span className="mt-2 block text-xs leading-5 text-amber-700">
                    Used as the permanent base for accounting entries once posting starts.
                  </span>
                </div>

                <SearchableSelect
                  label="Financial year starts"
                  name="financial_year_start_month"
                  defaultValue="7"
                  options={FINANCIAL_YEAR_OPTIONS}
                  required
                  clearable={false}
                  searchPlaceholder="Search month..."
                />
              </div>

              <SearchableSelect
                label="Timezone"
                name="timezone"
                defaultValue="Asia/Dhaka"
                options={TIMEZONE_OPTIONS}
                required
                clearable={false}
                searchPlaceholder="Search timezone..."
              />

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="flex justify-end border-t pt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-6 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
                  Create company workspace
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
