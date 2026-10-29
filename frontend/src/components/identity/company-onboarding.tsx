"use client";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice } from "@/components/auth/auth-notice";
import { SearchableSelect, type SearchOption } from "@/components/searchable-select";
import { BUSINESS_TYPE_OPTIONS, COMPANY_SIZE_OPTIONS, COUNTRY_OPTIONS, CURRENCY_OPTIONS, TIMEZONE_OPTIONS } from "@/lib/company-options";
import { useCompanyOnboarding } from "@/hooks/use-company-onboarding";
import type { CompanyFields } from "./identity-model";
import "./identity.css";
const MONTHS: SearchOption[] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((label, i) => ({ label, value: String(i + 1) }));
export function CompanyOnboardingWorkspace() {
  const query = useSearchParams(), createAnother = query.get("new") === "1";
  return <CompanyOnboardingForm key={createAnother ? "new-company" : "first-company"} createAnother={createAnother} />;
}
export function CompanyOnboardingForm({ createAnother }: { createAnother: boolean }) {
  const vm = useCompanyOnboarding(createAnother);
  const select = (field: keyof CompanyFields, label: string, options: SearchOption[]) => <SearchableSelect name={field} label={label} value={vm.values[field]} onChange={value => vm.change(field, value)} options={options} clearable={false} required searchPlaceholder={`Search ${label.toLowerCase()}…`} />;
  return <AuthFrame variant="login" eyebrow="COMPANY SETUP" title={vm.phase === "confirmed" ? "Your workspace is created." : "A home for your business."} description="Set the company identity and operating defaults. Your account becomes the owner of this new workspace." asideTitle="Build your workspace." asideDescription="Company setup.">
    <div className="identity-content identity-onboarding">
      {vm.loading ? <p className="identity-loading" role="status"><Loader2 size={18} className="animate-spin" aria-hidden="true" />Checking current workspaces…</p> : null}
      {vm.readError ? <AuthNotice kind="error"><strong>Workspace discovery unavailable</strong><p>{vm.readError}</p></AuthNotice> : null}
      {vm.error ? <AuthNotice kind={vm.unresolved ? "info" : "error"}>{vm.error}</AuthNotice> : null}
      {vm.phase === "confirmed" ? <section className="identity-receipt" role="status"><Building2 size={28} aria-hidden="true" /><h2>Creation confirmed</h2><p>{vm.result?.organization.name}</p><p>If navigation did not finish, open your workspace below. Do not submit creation again.</p></section> : null}
      {vm.unresolved ? <section className="identity-recovery" aria-label="Review creation outcome"><h2>Review before another action</h2><p>Memberships show current access, not a receipt for the earlier request. A matching name—or no matching row—cannot prove whether it committed.</p><button className="identity-secondary" disabled={vm.loading || vm.pending} onClick={() => void vm.load()}>{vm.loading ? "Reviewing workspaces…" : "Review current workspaces"}</button>{vm.recoveryReady && vm.rows ? <><ul className="identity-workspaces">{vm.rows.map(row => <li key={row.membership_id}><div><strong>{row.organization.name}</strong><span>{row.role_name} · {row.organization.currency}</span></div><small>{row.organization.status} / membership {row.status}</small></li>)}</ul>{vm.rows.length === 0 ? <p>No memberships were returned. This does not establish that the earlier creation failed.</p> : null}{vm.phase === "unknown" ? <><label className="identity-check"><input type="checkbox" checked={vm.reviewed} onChange={e => vm.acknowledgeReview(e.target.checked)} />I reviewed current access and understand the earlier creation may still have succeeded.</label><button className="identity-secondary" disabled={!vm.reviewed} onClick={vm.beginNewIntent}>Start fresh company setup</button><p className="identity-caption">This opens a separate new=1 setup intent with fresh defaults, discarding these entered settings. It does not create or retry anything automatically.</p></> : null}</> : null}</section> : null}
      {vm.rows && !vm.loading && (vm.phase === "idle" || vm.phase === "pending") && (createAnother || vm.rows.length === 0) ? <form className="identity-form" aria-label="Create company workspace" onSubmit={e => { e.preventDefault(); void vm.create(); }}><fieldset disabled={vm.pending || !vm.canCreate && vm.phase !== "pending"}>
        {createAnother && vm.rows.length > 0 ? <p className="identity-note">You already have {vm.rows.length} workspace membership{vm.rows.length === 1 ? "" : "s"}. This form creates a separate company; it does not edit an existing one.</p> : null}
        <section className="identity-form-section"><div className="identity-section-label"><span>01</span><h2>Company identity</h2></div><label className="identity-field">Company name<input name="name" autoComplete="organization" required minLength={2} maxLength={180} placeholder="Your company name" value={vm.values.name} onChange={e => vm.change("name", e.target.value)} /></label><div className="identity-grid">{select("business_type", "Business type", BUSINESS_TYPE_OPTIONS)}{select("team_size", "Team size", COMPANY_SIZE_OPTIONS)}</div></section>
        <section className="identity-form-section"><div className="identity-section-label"><span>02</span><h2>Operating defaults</h2></div><div className="identity-grid">{select("country_code", "Country", COUNTRY_OPTIONS)}{select("currency", "Accounting / functional currency", CURRENCY_OPTIONS)}</div><p className="identity-currency-warning"><strong>Choose the currency you keep your books in.</strong> This is the base for journals, ledger and financial statements. After entries are posted, a change needs controlled currency migration—not simply relabeling balances.</p><details className="identity-explanation"><summary>Reporting and client currencies</summary><p>These can be configured separately in Company & Settings → Currencies & FX.</p></details>{select("timezone", "Timezone", TIMEZONE_OPTIONS)}{select("financial_year_start_month", "Financial year starts", MONTHS)}</section>
        <button className="login-submit" type="submit" disabled={vm.pending || !vm.canCreate}>{vm.pending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Building2 size={18} aria-hidden="true" />}{vm.pending ? "Creating workspace…" : "Create company workspace"}</button>
      </fieldset></form> : null}
      {vm.readError && !vm.unresolved ? <button className="identity-secondary" disabled={vm.loading} onClick={() => void vm.load()}>Retry workspace discovery</button> : null}
      <button className={vm.phase === "confirmed" ? "login-submit" : "identity-link"} disabled={vm.pending} onClick={vm.openWorkspace}>Return to your workspace <ArrowRight size={16} aria-hidden="true" /></button>
      <p className="identity-caption">Interrupted creation can still complete. Review access before another attempt. Unsaved settings and this page’s operation lock are held only in memory; reload or closing can lose them.</p>
    </div>
  </AuthFrame>;
}
