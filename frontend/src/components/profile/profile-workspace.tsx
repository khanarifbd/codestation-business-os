"use client";
import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Camera, ShieldCheck, UserRound } from "lucide-react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { ProfileSignInIdentities } from "@/components/profile-sign-in-identities";
import { ProfilePasskeysSection } from "@/components/profile-passkeys-section";
import { ProfileSessionsSection } from "@/components/profile-sessions-section";
import { ProfileEditor } from "./profile-editor";
import { ProfileAvatar, ProfileDestination } from "./profile-primitives";
import { accountIdentity, accountKey, profileDate, type Profile } from "./profile-model";
import { PROFILE_ROUTES, profileMode, type ProfileMode } from "@/lib/profile-navigation";
import { useProfileAccount, type ProfileAccountState } from "@/hooks/use-profile-account";
import { useProfileOperation, type ProfileOperation } from "@/hooks/use-profile-operation";
const TITLES: Record<ProfileMode, string> = { overview: "Your account", edit: "Personal details", photo: "Profile photo", security: "Sign-in & security", username: "Your username", password: "Password", google: "Google sign-in", passkeys: "Your passkeys", enrollment: "Add a passkey", sessions: "Devices & sessions" };
function Overview({ profile }: { profile: Profile }) { return <><section className="pa-identity"><ProfileAvatar profile={profile} large/><div><p className="pa-kicker">Personal account · all workspaces</p><h2>{profile.full_name}</h2><p>{profile.email}</p><div className="pa-badges"><span>{profile.is_active ? "Active account" : "Inactive account"}</span><span>{profile.is_verified ? "Email verified" : "Email not verified"}</span><span>{profile.system_role.replaceAll("_", " ")}</span></div></div></section><div className="pa-columns"><section className="pa-section"><div className="pa-section-heading"><h2>Personal details</h2><a href={PROFILE_ROUTES.edit}>Edit details <ArrowUpRight size={15}/></a></div><dl className="pa-facts"><div><dt>Full name</dt><dd>{profile.full_name}</dd></div><div><dt>Primary email</dt><dd>{profile.email}<small>Read-only account identity</small></dd></div><div><dt>Phone</dt><dd>{profile.phone || "Not added"}</dd></div><div><dt>Personal timezone</dt><dd>{profile.timezone || "Not set"}</dd></div><div><dt>Member since</dt><dd>{profileDate(profile.created_at)}</dd></div><div><dt>Last updated</dt><dd>{profileDate(profile.updated_at)}</dd></div></dl><p className="pa-note">Account dates are shown in your browser’s local timezone.</p></section><section className="pa-section"><h2>Manage your account</h2><div className="pa-destinations"><ProfileDestination href={PROFILE_ROUTES.edit} title="Edit personal details" icon={UserRound}>Name, phone and personal timezone</ProfileDestination><ProfileDestination href={PROFILE_ROUTES.photo} title="Update profile photo" icon={Camera}>Choose, replace or remove your photo</ProfileDestination><ProfileDestination href={PROFILE_ROUTES.security} title="Sign-in & security" icon={ShieldCheck}>Your credentials, passkeys and sessions</ProfileDestination></div><p className="pa-note">These settings belong to you, not to a single company workspace.</p></section></div></>; }
export function ProfileOutcome({ op }: { op: ProfileOperation }) { if (!op.message) return null; const tone = op.phase === "confirmed" ? "success" : op.phase === "rejected" ? "error" : "info"; return <RelationshipNotice tone={tone}><div className="pa-outcome"><strong>{op.phase === "confirmed" ? "Confirmed result" : op.phase === "acknowledged" ? "Acknowledged · details unverified" : op.phase === "unknown" ? "Outcome unknown" : op.phase === "verification" ? "Fresh verification" : "Review this information"}</strong><p>{op.message}</p>{op.unresolved ? <p>This lock exists only in this open document. Reloading or closing can lose it; neither a matching nor a missing later record proves the earlier result.</p> : null}{["confirmed", "acknowledged", "unknown"].includes(op.phase) ? <div className="pa-actions">{op.action === "password" ? <button className="relationship-primary" onClick={op.signIn}>Go to sign in</button> : <button className="relationship-secondary" onClick={() => void op.refresh()}>Review current account information</button>}<button className="relationship-secondary" onClick={op.back}>Back to account settings</button></div> : null}</div></RelationshipNotice>; }
function Confirmation({ op }: { op: ProfileOperation }) { const region = useRef<HTMLElement>(null); const review = op.review; useLayoutEffect(() => { region.current?.focus(); }, [review]); if (!review) return null; return <section ref={region} tabIndex={-1} className="pa-section pa-confirmation" aria-labelledby="pa-confirm-title"><p className="pa-kicker">Review account action</p><h2 id="pa-confirm-title">{review.title}</h2><p>{review.description}</p><p className="pa-note">This confirmation is bound to the account and records you just reviewed. It does not create a retry guarantee if the response is interrupted.</p><div className="pa-actions"><button className="relationship-secondary" disabled={op.busy} onClick={op.closeReview}>Cancel</button><button className="relationship-primary" disabled={op.busy} onClick={() => void op.confirmReview()}>{op.busy ? "Applying…" : "Confirm action"}</button></div><p role="status">{op.busy ? "Request pending. Keep this page open; do not repeat the action." : "No change is made until you confirm."}</p></section>; }
function AccountDocument({ observed, mode }: { observed: NonNullable<ReturnType<typeof accountIdentity>>; mode: ProfileMode }) {
  const account = useProfileAccount(observed, mode), op = useProfileOperation(account);
  const opener = useRef<HTMLElement | null>(null), restoreAfterCancel = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!op.review && restoreAfterCancel.current) {
      restoreAfterCancel.current = false;
      const target = opener.current; opener.current = null;
      if (target?.isConnected && !target.matches(":disabled") && !target.closest("[hidden]")) {
        // Native focus scroll can leave the opener behind the mobile bottom bar.
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      } else heading.current?.focus();
    }
  }, [op.review]);
  const cancelReview = () => { const closed = op.closeReview(); if (closed) restoreAfterCancel.current = true; return closed; };
  return <RelationshipPage className="profile-account">
    <header className="pa-header"><div><p className="pa-kicker">Account settings</p><h1 ref={heading} tabIndex={-1}>{TITLES[mode]}</h1><p>Personal identity and access across your workspaces.</p></div><button className="relationship-secondary" onClick={op.back} disabled={op.busy}><ArrowLeft size={16}/> Back</button></header>
    <ProfileOutcome op={op}/>
    {account.loading ? <p className="pa-read-status" role="status">{account.data ? "Refreshing current information; changes are unavailable until verified." : "Verifying your account…"}</p> : null}
    {account.error ? <RelationshipNotice tone="error"><p>{account.error}</p><button className="relationship-secondary" disabled={op.busy} onClick={() => void op.refresh()}>Retry account read</button>{account.data ? <p>Previously verified information is shown read-only; it is not a current operation receipt.</p> : null}</RelationshipNotice> : null}
    {op.review ? <Confirmation op={{ ...op, closeReview: cancelReview }}/> : null}
    {/* Keep the editor and selected File alive. This is hidden/inert, never a
        second visible form under the review. Only explicit Cancel restores focus. */}
    <div data-profile-content="" hidden={Boolean(op.review)} inert={Boolean(op.review)} onClickCapture={event => {
      const target = event.target instanceof Element ? event.target.closest("[data-profile-review]") : null;
      if (target instanceof HTMLElement) opener.current = target;
    }}>
      {account.data ? <Content account={account} op={op}/> : !account.loading && !account.error ? <p role="alert">Account details are unavailable.</p> : null}
    </div>
  </RelationshipPage>;
}
function Content({ account, op }: { account: ProfileAccountState; op: ProfileOperation }) { const data = account.data!; if (account.mode === "overview") return <Overview profile={data.profile}/>; if (account.mode === "security") return <ProfileSignInIdentities data={data}/>; if (account.mode === "passkeys") return <ProfilePasskeysSection account={account} op={op}/>; if (account.mode === "sessions") return <ProfileSessionsSection account={account} op={op}/>; return <ProfileEditor account={account} op={op}/>; }
export function ProfileWorkspace() { const session = useDashboardSession(), pathname = usePathname(), mode = profileMode(pathname); const observed = accountIdentity(session.profile); if (!mode) return <RelationshipPage><h1>Account page unavailable</h1><a href={PROFILE_ROUTES.overview}>Return to your account</a></RelationshipPage>; if (session.loading) return <RelationshipPage><p role="status">Verifying account access…</p></RelationshipPage>; if (!observed || !observed.is_active) return <RelationshipPage><h1>Account access could not be verified</h1><RelationshipNotice tone="error">{session.error || "Reload account access before opening these settings."}</RelationshipNotice><button className="relationship-secondary" onClick={() => void session.reload()}>Retry account access</button></RelationshipPage>; return <AccountDocument key={`${accountKey(observed)}:${mode}`} observed={observed} mode={mode}/>; }
