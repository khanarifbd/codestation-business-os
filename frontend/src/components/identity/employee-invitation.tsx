"use client";
import { ArrowRight, BadgeCheck, Building2, Loader2 } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice } from "@/components/auth/auth-notice";
import { IdentityPassword } from "./identity-fields";
import { useEmployeeInvitation } from "@/hooks/use-employee-invitation";
import "./identity.css";
export function EmployeeInvitationWorkspace({ token }: { token: string }) { return <EmployeeInvitationForm key={token} token={token} />; }
export function EmployeeInvitationForm({ token }: { token: string }) {
  const vm = useEmployeeInvitation(token);
  return <AuthFrame variant="login" eyebrow="TEAM INVITATION" title={vm.phase === "confirmed" ? "Invitation accepted." : "Your team is ready for you."} description={vm.phase === "confirmed" ? "Acceptance is confirmed. Sign in separately to open your workspace." : "Review the company and role before joining. Accepting does not sign you in."} asideTitle="Work together." asideDescription="Your company invitation.">
    <div className="identity-content">
      {vm.loading ? <p className="identity-loading" role="status"><Loader2 size={18} className="animate-spin" aria-hidden="true" />Verifying invitation…</p> : null}
      {vm.readError ? <AuthNotice kind="error"><strong>Invitation unavailable</strong><p>{vm.readError}</p></AuthNotice> : null}
      {vm.preview && vm.phase !== "confirmed" ? <section className="identity-context" aria-label="Invitation details"><div className="identity-company"><Building2 size={21} aria-hidden="true" /><div><span>INVITED BY</span><h2>{vm.preview.company_name}</h2></div></div><dl><div><dt>Team member</dt><dd>{vm.preview.full_name}</dd></div><div><dt>Role</dt><dd>{vm.preview.role_name}</dd></div><div className="identity-span"><dt>Email</dt><dd>{vm.preview.email}</dd></div><div><dt>Employee code</dt><dd>{vm.preview.employee_code}</dd></div><div><dt>Expires · your local time</dt><dd>{new Date(vm.preview.expires_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd></div></dl></section> : null}
      {vm.error ? <AuthNotice kind={vm.uncertain ? "info" : "error"}>{vm.error}</AuthNotice> : null}
      {vm.preview && (vm.phase === "idle" || vm.phase === "pending") ? <form className="identity-form" aria-label="Accept employee invitation" onSubmit={e => { e.preventDefault(); void vm.accept(); }}><p className="identity-note">{vm.preview.existing_user ? "Use the existing Business OS password for this email. Passwordless accounts cannot accept through this password-based flow." : "Create a Business OS password for the invited email. Use 8–128 characters."}</p><fieldset disabled={vm.pending}><IdentityPassword label={vm.preview.existing_user ? "Existing password" : "Create password"} name="password" value={vm.password} onChange={value => vm.change("password", value)} existing={vm.preview.existing_user} disabled={vm.pending} /><IdentityPassword label="Confirm password" name="confirm_password" value={vm.confirmation} onChange={value => vm.change("confirmation", value)} existing={vm.preview.existing_user} disabled={vm.pending} /><button className="login-submit" type="submit">{vm.pending ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <BadgeCheck size={18} aria-hidden="true" />}{vm.pending ? "Accepting invitation…" : "Accept invitation"}</button></fieldset></form> : null}
      {vm.phase === "confirmed" ? <section className="identity-receipt" role="status"><BadgeCheck size={30} aria-hidden="true" /><h2>Invitation accepted</h2><p>{vm.result?.company_name} · {vm.result?.employee_code}</p><p>This is an acknowledgment, not a signed-in session. Workspace access is checked when you sign in.</p></section> : null}
      {(vm.readError || vm.uncertain) && !vm.pending ? <button className="identity-secondary" disabled={vm.loading} onClick={() => void vm.refresh()}>{vm.loading ? "Checking…" : "Check invitation availability"}</button> : null}
      <button className={vm.phase === "confirmed" ? "login-submit" : "identity-link"} disabled={vm.pending} onClick={vm.signIn}>Sign in to Business OS <ArrowRight size={16} aria-hidden="true" /></button>
      <p className="identity-caption">If a request is interrupted, check access before trying elsewhere. This page’s duplicate-submit protection is memory-only and does not survive reload or closing. Never share this invitation link or your password.</p>
    </div>
  </AuthFrame>;
}
