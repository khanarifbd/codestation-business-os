"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2 } from "lucide-react";

const businessTypes = [
  "Software & IT Services",
  "Agency",
  "Consulting",
  "E-commerce",
  "Professional Services",
  "Other",
];

const teamSizes = ["1", "2-5", "6-10", "11-25", "26-50", "51-100", "100+"];

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
          <div>
            <p className="text-sm text-neutral-500">CodeStation AI</p>
            <h1 className="text-xl font-semibold">Business OS</h1>
          </div>
          <div className="rounded-full border bg-white px-3 py-1 text-xs font-medium text-neutral-600">
            Company setup
          </div>
        </header>

        <div className="grid overflow-hidden rounded-3xl border bg-white shadow-sm lg:grid-cols-[0.72fr_1.28fr]">
          <aside className="border-b bg-neutral-950 p-8 text-white lg:border-b-0 lg:border-r lg:p-10">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-white/10">
              <Building2 className="size-5" />
            </div>
            <h2 className="mt-8 text-3xl font-semibold tracking-tight">Set up your company.</h2>
            <p className="mt-4 text-sm leading-6 text-white/50">
              These settings create the tenant boundary used by clients, orders, projects, finance, HR, and reports.
            </p>
            <div className="mt-8 space-y-3 text-sm text-white/65">
              {[
                "Private company workspace",
                "Owner role created automatically",
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
                You can change these settings later from company settings.
              </p>
            </div>

            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              <label className="block text-sm font-medium">
                Company name
                <input
                  name="name"
                  defaultValue="CodeStation AI"
                  required
                  minLength={2}
                  className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500"
                  placeholder="Your company name"
                />
              </label>

              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Business type
                  <select
                    name="business_type"
                    defaultValue="Software & IT Services"
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 outline-none focus:border-neutral-500"
                  >
                    {businessTypes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  Team size
                  <select
                    name="team_size"
                    defaultValue="2-5"
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 outline-none focus:border-neutral-500"
                  >
                    {teamSizes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <label className="block text-sm font-medium">
                  Country
                  <select
                    name="country_code"
                    defaultValue="BD"
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 outline-none focus:border-neutral-500"
                  >
                    <option value="BD">Bangladesh</option>
                    <option value="AU">Australia</option>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="CA">Canada</option>
                    <option value="DE">Germany</option>
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  Currency
                  <select
                    name="currency"
                    defaultValue="BDT"
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 outline-none focus:border-neutral-500"
                  >
                    <option value="BDT">BDT</option>
                    <option value="USD">USD</option>
                    <option value="AUD">AUD</option>
                    <option value="GBP">GBP</option>
                    <option value="EUR">EUR</option>
                    <option value="CAD">CAD</option>
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  Financial year starts
                  <select
                    name="financial_year_start_month"
                    defaultValue="7"
                    className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 outline-none focus:border-neutral-500"
                  >
                    {[
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
                    ].map((month, index) => (
                      <option key={month} value={index + 1}>
                        {month}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-medium">
                Timezone
                <select
                  name="timezone"
                  defaultValue="Asia/Dhaka"
                  className="mt-2 h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 outline-none focus:border-neutral-500"
                >
                  <option value="Asia/Dhaka">Asia/Dhaka (UTC+6)</option>
                  <option value="Australia/Sydney">Australia/Sydney</option>
                  <option value="America/New_York">America/New_York</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="Europe/Berlin">Europe/Berlin</option>
                  <option value="UTC">UTC</option>
                </select>
              </label>

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
