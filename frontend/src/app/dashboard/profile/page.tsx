"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  MonitorSmartphone,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

import { GoogleReauthButton } from "@/components/auth/google-reauth-button";
import { PasswordField } from "@/components/auth/password-field";
import { ProfileSessionsSection } from "@/components/profile-sessions-section";
import { ProfileSignInIdentities } from "@/components/profile-sign-in-identities";
import { SearchableSelect } from "@/components/searchable-select";
import { TIMEZONE_OPTIONS } from "@/lib/company-options";

type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  timezone: string | null;
  system_role: string;
  is_active: boolean;
  is_verified: boolean;
  has_password: boolean;
  google_connected: boolean;
  has_avatar: boolean;
  avatar_version: number;
  created_at: string;
  updated_at: string;
};

type ProfileTab = "profile" | "security" | "sessions";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function readableDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function avatarUrl(profile: Profile) {
  return `/api/profile/avatar?v=${profile.avatar_version}`;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("profile");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const passwordSetupFormRef = useRef<HTMLFormElement>(null);

  const timezoneOptions = useMemo(
    () => [{ value: "", label: "Use workspace / device timezone" }, ...TIMEZONE_OPTIONS],
    [],
  );

  function applyProfile(next: Profile) {
    setProfile(next);
    setFullName(next.full_name);
    setPhone(next.phone ?? "");
    setTimezone(next.timezone ?? "");
    window.dispatchEvent(new Event("business-os-profile-updated"));
  }

  async function loadProfile(showLoading = true) {
    if (showLoading) setLoading(true);
    setProfileError(null);
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to load your profile.");
      applyProfile(payload as Profile);
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : "Unable to load your profile.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => { void loadProfile(); }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          timezone: timezone || null,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to save your profile.");
      applyProfile(payload as Profile);
      setProfileMessage("Profile updated successfully.");
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : "Unable to save your profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarError(null);
    setAvatarMessage(null);
    if (!AVATAR_TYPES.has(file.type)) {
      setAvatarError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("Profile photo must be 5 MB or smaller.");
      return;
    }

    setSavingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/profile/avatar", { method: "PUT", body: form });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to upload your profile photo.");
      applyProfile(payload as Profile);
      setAvatarMessage("Profile photo updated.");
    } catch (reason) {
      setAvatarError(reason instanceof Error ? reason.message : "Unable to upload your profile photo.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function removeAvatar() {
    setAvatarError(null);
    setAvatarMessage(null);
    setSavingAvatar(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to remove your profile photo.");
      applyProfile(payload as Profile);
      setAvatarMessage("Profile photo removed.");
    } catch (reason) {
      setAvatarError(reason instanceof Error ? reason.message : "Unable to remove your profile photo.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("current_password") ?? "");
    const newPassword = String(form.get("new_password") ?? "");
    const confirmPassword = String(form.get("confirm_password") ?? "");
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("New password must be different from your current password.");
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? "Unable to change your password.");
      }
      formElement.reset();
      setPasswordMessage("Password changed successfully. Use the new password next time you sign in.");
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "Unable to change your password.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function setupPasswordWithGoogle(credential: string) {
    const formElement = passwordSetupFormRef.current;
    if (!formElement) return;
    setPasswordError(null);
    setPasswordMessage(null);
    const form = new FormData(formElement);
    const newPassword = String(form.get("new_password") ?? "");
    const confirmPassword = String(form.get("confirm_password") ?? "");
    if (newPassword.length < 8) {
      setPasswordError("Enter a password with at least 8 characters before verifying with Google.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch("/api/profile/password/google-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, new_password: newPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail ?? "Unable to create your password.");
      applyProfile(payload as Profile);
      formElement.reset();
      setPasswordMessage("Password created successfully. You can now sign in with Google or email and password.");
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : "Unable to create your password.");
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return <main className="flex min-h-[70vh] items-center justify-center p-6"><Loader2 className="size-6 animate-spin text-neutral-400" /></main>;
  }

  if (!profile) {
    return <main className="p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-5xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{profileError ?? "Your profile is unavailable."}</div></main>;
  }

  const tabs: Array<{ id: ProfileTab; label: string; description: string; icon: typeof UserRound }> = [
    { id: "profile", label: "Profile", description: "Personal details", icon: UserRound },
    { id: "security", label: "Security", description: "Password & sign-in", icon: ShieldCheck },
    { id: "sessions", label: "Sessions", description: "Devices & history", icon: MonitorSmartphone },
  ];

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-3xl border bg-neutral-950 text-white shadow-sm">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="flex items-start gap-4 sm:gap-5">
              <div className="relative shrink-0">
                <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/10 text-xl font-semibold sm:size-20 sm:text-2xl">
                  {profile.has_avatar ? <img src={avatarUrl(profile)} alt={`${profile.full_name} profile`} className="h-full w-full object-cover" /> : initials(profile.full_name)}
                </div>
                <label className="absolute -bottom-2 -right-2 flex size-8 cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white text-neutral-950 shadow-lg transition hover:bg-neutral-100" title="Upload profile photo">
                  {savingAvatar ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={savingAvatar} onChange={uploadAvatar} className="sr-only" />
                </label>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">My account</p>
                <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{profile.full_name}</h1>
                <p className="mt-1 truncate text-sm text-white/55">{profile.email}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {profile.is_verified ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-200"><BadgeCheck className="size-3.5" />Verified account</span> : null}
                  {profile.google_connected ? <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-white/70">Google connected</span> : null}
                  {profile.has_password ? <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-white/70">Password enabled</span> : null}
                  {profile.has_avatar ? <button type="button" disabled={savingAvatar} onClick={() => void removeAvatar()} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-xs font-medium text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-50"><Trash2 className="size-3" />Remove photo</button> : null}
                </div>
                {avatarError ? <p role="alert" className="mt-3 text-xs text-red-300">{avatarError}</p> : null}
                {avatarMessage ? <p className="mt-3 text-xs text-emerald-300">{avatarMessage}</p> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:min-w-72">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5"><p className="text-white/40">Member since</p><p className="mt-1 font-medium text-white/85">{readableDate(profile.created_at)}</p></div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3.5"><p className="text-white/40">Account status</p><p className="mt-1 font-medium text-white/85">{profile.is_active ? "Active" : "Inactive"}</p></div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-2 shadow-sm" aria-label="Profile settings navigation">
          <div className="grid grid-cols-3 gap-2" role="tablist">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return <button key={tab.id} type="button" role="tab" aria-selected={selected} onClick={() => setActiveTab(tab.id)} className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-left transition sm:justify-start sm:px-4 ${selected ? "bg-neutral-950 text-white shadow-sm" : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950"}`}>
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0"><span className="block text-sm font-semibold">{tab.label}</span><span className={`hidden truncate text-xs sm:block ${selected ? "text-white/55" : "text-neutral-400"}`}>{tab.description}</span></span>
              </button>;
            })}
          </div>
        </section>

        {activeTab === "profile" ? <div className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr]">
          <form onSubmit={saveProfile} className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b pb-5">
              <div><div className="flex items-center gap-2"><UserRound className="size-5" /><h2 className="font-semibold">Personal information</h2></div><p className="mt-1 text-sm text-neutral-500">Your personal account details are shared across every Business OS workspace you can access.</p></div>
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="block text-sm font-medium text-neutral-800">Full name<input value={fullName} onChange={(event) => { setFullName(event.target.value); setProfileError(null); setProfileMessage(null); }} minLength={2} maxLength={160} required className="mt-2 h-12 w-full rounded-xl border border-neutral-200 px-4 outline-none transition focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]" placeholder="Your full name" /></label>
              <label className="block text-sm font-medium text-neutral-800">Phone number<div className="relative mt-2"><Phone className="absolute left-3.5 top-3.5 size-4 text-neutral-400" /><input value={phone} onChange={(event) => { setPhone(event.target.value); setProfileError(null); setProfileMessage(null); }} maxLength={40} className="h-12 w-full rounded-xl border border-neutral-200 pl-10 pr-4 outline-none transition focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]" placeholder="+880 ..." /></div></label>
              <label className="block text-sm font-medium text-neutral-800">Primary email<div className="relative mt-2"><Mail className="absolute left-3.5 top-3.5 size-4 text-neutral-400" /><input value={profile.email} readOnly className="h-12 w-full cursor-not-allowed rounded-xl border border-neutral-200 bg-neutral-50 pl-10 pr-4 text-neutral-500" /></div><span className="mt-2 block text-xs leading-5 text-neutral-400">Your login email is protected. Email changes require a verified identity-change flow rather than a simple profile edit.</span></label>
              <SearchableSelect label="Personal timezone" name="profile_timezone" value={timezone} onValueChange={(value) => { setTimezone(value); setProfileError(null); setProfileMessage(null); }} options={timezoneOptions} placeholder="Use workspace / device timezone" />
            </div>
            {profileError ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{profileError}</div> : null}
            {profileMessage ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="size-4" />{profileMessage}</div> : null}
            <div className="mt-6 flex justify-end border-t pt-5"><button type="submit" disabled={savingProfile} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save profile</button></div>
          </form>

          <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2"><CalendarDays className="size-5" /><h2 className="font-semibold">Account details</h2></div>
            <p className="mt-1 text-sm text-neutral-500">Read-only identity information for this Business OS account.</p>
            <dl className="mt-6 space-y-4 text-sm">
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50 p-4"><dt className="text-neutral-500">Account ID</dt><dd className="max-w-[220px] truncate font-mono text-xs">{profile.id}</dd></div>
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50 p-4"><dt className="text-neutral-500">Created</dt><dd className="font-medium">{readableDate(profile.created_at)}</dd></div>
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50 p-4"><dt className="text-neutral-500">Last updated</dt><dd className="font-medium">{readableDate(profile.updated_at)}</dd></div>
            </dl>
          </section>
        </div> : null}

        {activeTab === "security" ? <div className="grid gap-6 xl:grid-cols-[1.35fr_0.85fr] xl:items-start">
          <div className="space-y-6">
            <ProfileSignInIdentities onProfileChanged={() => loadProfile(false)} />

            <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-start gap-3 border-b pb-5"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100"><LockKeyhole className="size-5" /></div><div><h2 className="font-semibold">Password & sign-in</h2><p className="mt-1 text-sm text-neutral-500">Manage the password attached to your global Business OS identity.</p></div></div>

              {profile.has_password ? (
                <form onSubmit={changePassword} className="mt-6">
                  <div className="grid gap-5 md:grid-cols-3">
                    <PasswordField name="current_password" label="Current password" autoComplete="current-password" placeholder="Current password" />
                    <PasswordField name="new_password" label="New password" autoComplete="new-password" placeholder="At least 8 characters" />
                    <PasswordField name="confirm_password" label="Confirm new password" autoComplete="new-password" placeholder="Repeat new password" />
                  </div>
                  {passwordError ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordError}</div> : null}
                  {passwordMessage ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="size-4" />{passwordMessage}</div> : null}
                  <div className="mt-6 flex justify-end"><button type="submit" disabled={savingPassword} className="inline-flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{savingPassword ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}Change password</button></div>
                </form>
              ) : profile.google_connected ? (
                <form ref={passwordSetupFormRef} onSubmit={(event) => event.preventDefault()} className="mt-6">
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-900">
                    <p className="font-semibold">Create an optional password for this Google account</p>
                    <p className="mt-1 text-blue-800">After you set one, you can sign in with Google, email or username. To protect against a stolen Business OS session, we require a fresh verification from the Google account already linked to this profile.</p>
                  </div>
                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    <PasswordField name="new_password" label="New password" autoComplete="new-password" placeholder="At least 8 characters" />
                    <PasswordField name="confirm_password" label="Confirm password" autoComplete="new-password" placeholder="Repeat new password" />
                  </div>
                  {passwordError ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordError}</div> : null}
                  {passwordMessage ? <div className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="size-4" />{passwordMessage}</div> : null}
                  <div className="mt-5 border-t pt-5"><p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-neutral-400">Verify identity and save</p><GoogleReauthButton busy={savingPassword} busyLabel="Saving password…" onCredential={setupPasswordWithGoogle} /></div>
                </form>
              ) : (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Connect Google above first to create a password securely for this account.</div>
              )}
            </section>
          </div>

          <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-2"><ShieldCheck className="size-5" /><h2 className="font-semibold">Security overview</h2></div>
            <p className="mt-1 text-sm text-neutral-500">Quick status of the identity and sign-in methods protecting this account.</p>
            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-start gap-3 rounded-2xl bg-neutral-50 p-4"><Mail className="mt-0.5 size-4 text-neutral-400" /><div className="min-w-0"><p className="font-medium">Email identity</p><p className="mt-1 break-all text-neutral-500">{profile.email}</p><p className="mt-1 text-xs text-emerald-700">{profile.is_verified ? "Verified" : "Verification required"}</p></div></div>
              <div className="flex items-start gap-3 rounded-2xl bg-neutral-50 p-4"><KeyRound className="mt-0.5 size-4 text-neutral-400" /><div><p className="font-medium">Sign-in methods</p><p className="mt-1 text-neutral-500">{[profile.has_password ? "Email / username + Password" : null, profile.google_connected ? "Google" : null].filter(Boolean).join(" + ") || "Account authentication"}</p></div></div>
              <div className="flex items-start gap-3 rounded-2xl bg-neutral-50 p-4"><MonitorSmartphone className="mt-0.5 size-4 text-neutral-400" /><div><p className="font-medium">Device security</p><p className="mt-1 text-neutral-500">Review and remotely sign out devices from the Sessions tab.</p><button type="button" onClick={() => setActiveTab("sessions")} className="mt-2 text-xs font-semibold text-neutral-950 underline-offset-4 hover:underline">Open sessions</button></div></div>
              <div className="flex items-start gap-3 rounded-2xl bg-neutral-50 p-4"><Clock3 className="mt-0.5 size-4 text-neutral-400" /><div><p className="font-medium">Personal timezone</p><p className="mt-1 text-neutral-500">{profile.timezone || "Workspace / device default"}</p></div></div>
            </div>
          </section>
        </div> : null}

        {activeTab === "sessions" ? <ProfileSessionsSection /> : null}
      </div>
    </main>
  );
}
