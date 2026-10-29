"use client";

import { useId, useState } from "react";
import { ArrowRight, BadgeCheck, Building2, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthNotice } from "@/components/auth/auth-notice";
import { useClientInvitation } from "@/hooks/use-client-invitation";
import "./client-invitation.css";

function InvitationPassword({ label, name, value, onChange, disabled, autoComplete }: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  autoComplete: string;
}) {
  const id = useId(), [visible, setVisible] = useState(false);
  return <div className="ci-field">
    <label htmlFor={id}>{label}</label>
    <div className="ci-password">
      <input id={id} name={name} type={visible ? "text" : "password"} value={value} onChange={event => onChange(event.target.value)} minLength={8} required disabled={disabled} autoComplete={autoComplete} placeholder={name === "password" ? "At least 8 characters" : "Repeat the password"} />
      <button type="button" disabled={disabled} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(current => !current)}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
    </div>
  </div>;
}
function invitationExpiry(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "See your invitation email" : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function ClientInvitation({ token }: { token: string }) {
  return <InvitationForm key={token} token={token} />;
}
export function InvitationForm({ token }: { token: string }) {
  const vm = useClientInvitation(token);
  return <AuthFrame variant="login" eyebrow="CLIENT PORTAL INVITATION" title={vm.phase === "accepted" ? "Invitation accepted." : "A workspace shared with you."} description={vm.phase === "accepted" ? "Sign in to check the client workspace linked by this invitation." : "Review who invited you and the client profile before accepting."} asideTitle="Work together." asideDescription="Review your invitation.">
    <div className="ci-content">
      {vm.loading ? <div className="ci-loading" role="status"><Loader2 size={20} className="animate-spin" aria-hidden="true" />Checking this invitation…</div> : null}
      {vm.readError ? <AuthNotice kind="error"><strong>Invitation unavailable</strong><p>{vm.readError}</p></AuthNotice> : null}
      {vm.preview && vm.phase !== "accepted" ? <section className="ci-invitation" aria-label="Inviting company and client profile">
        <div className="ci-company"><Building2 size={20} aria-hidden="true" /><div><span>Invited by</span><h2>{vm.preview.company_name}</h2></div></div>
        <dl><div><dt>Client profile</dt><dd>{vm.preview.client_name}</dd></div><div><dt>Invitation for</dt><dd>{vm.preview.full_name}</dd></div><div><dt><Mail size={12} aria-hidden="true" />Email</dt><dd>{vm.preview.email}</dd></div><div><dt>Link expires</dt><dd>{invitationExpiry(vm.preview.expires_at)} <small>your local time</small></dd></div></dl>
      </section> : null}
      {vm.error ? <AuthNotice kind={vm.uncertain ? "info" : "error"}>{vm.error}</AuthNotice> : null}
      {vm.preview && (vm.phase === "idle" || vm.phase === "pending") ? <form className="ci-form" aria-label="Accept client invitation" onSubmit={event => { event.preventDefault(); void vm.accept(); }}>
        <p className="ci-guidance">{vm.preview.existing_user ? vm.preview.requires_password ? "An account already exists for this email. Enter its current Business OS password to link the invitation." : "An account already exists for this email and does not require a password for this invitation. Review the details, then accept." : "Choose a Business OS password for the invited email. Accepting links the account to this client profile; it does not sign you in."}</p>
        {vm.needsPassword ? <div className="ci-fields"><InvitationPassword name="password" label={vm.preview.existing_user ? "Existing account password" : "Create password"} value={vm.password} onChange={value => vm.change("password", value)} disabled={vm.pending} autoComplete={vm.preview.existing_user ? "current-password" : "new-password"} /><InvitationPassword name="confirm_password" label="Confirm password" value={vm.confirmation} onChange={value => vm.change("confirmation", value)} disabled={vm.pending} autoComplete={vm.preview.existing_user ? "current-password" : "new-password"} /></div> : null}
        <button type="submit" disabled={vm.pending} className="login-submit">{vm.pending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <BadgeCheck size={17} aria-hidden="true" />}{vm.pending ? "Accepting invitation…" : "Accept invitation"}</button>
        <p className="ci-caption">The invitation grants a client relationship, not access to internal staff tools.</p>
      </form> : null}
      {vm.phase === "accepted" ? <div className="ci-success" role="status"><BadgeCheck size={30} aria-hidden="true" /><h2>Acceptance confirmed</h2><p>{vm.result?.company_name} · {vm.result?.client_name}</p><p>This does not sign you in. Workspace access is checked after sign-in and may depend on the company and client remaining active.</p></div> : null}
      {vm.uncertain ? <p className="ci-guidance">A status read cannot prove that a consumed or unavailable link was accepted by this request. This page will not submit acceptance again.</p> : null}
      {(vm.readError || vm.uncertain) && !vm.pending ? <button type="button" className="ci-secondary" disabled={vm.loading} onClick={() => void vm.refresh()}>{vm.loading ? "Checking invitation…" : vm.uncertain ? "Check invitation status" : "Retry invitation read"}</button> : null}
      <button type="button" className={vm.phase === "accepted" ? "login-submit" : "ci-sign-in"} disabled={vm.pending} onClick={vm.signIn}>Sign in to Business OS <ArrowRight size={15} aria-hidden="true" /></button>
      <p className="ci-footer-note">If this invitation is unexpected or access is unavailable, contact the inviting company. Do not share the invitation link or your password.</p>
    </div>
  </AuthFrame>;
}
