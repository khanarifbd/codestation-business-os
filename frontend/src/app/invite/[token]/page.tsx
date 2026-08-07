"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BadgeCheck, Loader2 } from "lucide-react";

type Preview = {
  company_name: string;
  email: string;
  full_name: string;
  role_name: string;
  employee_code: string;
  expires_at: string;
  existing_user: boolean;
};

export default function EmployeeInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/employee-invitations/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setError(payload?.detail ?? "This invitation is invalid or expired.");
      else setPreview(payload as Preview);
      setLoading(false);
    })();
  }, [token]);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirm_password") ?? "");
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setSaving(true); setError(null);
    const response = await fetch("/api/employee-invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const payload = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) { setError(payload?.detail ?? "Unable to accept invitation."); return; }
    setAccepted(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-5 text-neutral-950">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border bg-white shadow-sm">
        <div className="bg-neutral-950 px-7 py-7 text-white"><p className="text-xs uppercase tracking-[0.2em] text-white/45">CodeStation AI Business OS</p><h1 className="mt-2 text-2xl font-semibold">Employee invitation</h1></div>
        <div className="p-7">
          {loading ? <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin" /></div> : null}
          {!loading && error && !preview ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
          {preview && !accepted ? <>
            <div className="rounded-2xl border bg-neutral-50 p-5"><p className="font-semibold">{preview.company_name}</p><dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-neutral-400">Employee</dt><dd>{preview.full_name}</dd></div><div><dt className="text-neutral-400">Email</dt><dd>{preview.email}</dd></div><div><dt className="text-neutral-400">Role</dt><dd>{preview.role_name}</dd></div><div><dt className="text-neutral-400">Employee code</dt><dd>{preview.employee_code}</dd></div></dl></div>
            <form onSubmit={accept} className="mt-6 space-y-4"><p className="text-sm text-neutral-500">{preview.existing_user ? "Enter your existing Business OS password to accept this company invitation." : "Create your Business OS password to join this company."}</p><label className="block text-sm font-medium">Password<input name="password" type="password" minLength={8} required className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-neutral-500" /></label><label className="block text-sm font-medium">Confirm password<input name="confirm_password" type="password" minLength={8} required className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-neutral-500" /></label>{error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}<button disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-neutral-950 text-sm font-semibold text-white">{saving ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />} Accept invitation</button></form>
          </> : null}
          {accepted ? <div className="text-center"><BadgeCheck className="mx-auto size-10 text-emerald-600" /><h2 className="mt-4 text-xl font-semibold">Invitation accepted</h2><p className="mt-2 text-sm text-neutral-500">Your company access is ready.</p><button onClick={() => router.push("/login")} className="mt-6 h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white">Sign in to Business OS</button></div> : null}
        </div>
      </div>
    </main>
  );
}
