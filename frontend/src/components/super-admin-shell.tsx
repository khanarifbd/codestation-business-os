"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CreditCard,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

type Profile = {
  id: string;
  email: string;
  full_name: string;
  system_role: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/super-admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/super-admin/organizations", label: "Organizations", icon: Building2 },
  { href: "/super-admin/users", label: "Users", icon: UsersRound },
  { href: "/super-admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/super-admin/activity-logs", label: "Activity Logs", icon: Activity },
  { href: "/super-admin/system-health", label: "System Health", icon: HeartPulse },
];

function initials(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SA";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function routeIsActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Navigation({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="mt-7 space-y-1.5">
      {NAV_ITEMS.map((item) => {
        const active = routeIsActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-white text-neutral-950 shadow-sm"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const currentLabel = useMemo(
    () => NAV_ITEMS.find((item) => routeIsActive(pathname, item))?.label ?? "Platform Admin",
    [pathname],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      const response = await fetch("/api/profile", { cache: "no-store" });
      if (cancelled) return;
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) return;

      const payload = (await response.json()) as Profile;
      if (cancelled) return;
      if (payload.system_role !== "super_admin") {
        router.replace("/dashboard");
        return;
      }
      setProfile(payload);
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const identity = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-semibold text-neutral-950">
          {initials(profile?.full_name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {profile?.full_name ?? "Super Administrator"}
          </p>
          <p className="mt-0.5 truncate text-xs text-white/45">
            {profile?.email ?? "Platform access"}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-xs font-medium text-emerald-300">
        <ShieldCheck className="size-3.5" />
        Super Admin
      </div>
    </div>
  );

  const sidebarContent = (
    <>
      <div className="px-2 pt-2">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/10">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/40">
              CodeStation AI
            </p>
            <p className="mt-0.5 text-base font-semibold">Platform Admin</p>
          </div>
        </div>
      </div>

      <Navigation pathname={pathname} onNavigate={() => setMobileOpen(false)} />

      <div className="mt-auto space-y-3 pt-8">
        {identity}
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void logout()}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <LogOut className="size-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-950 lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col bg-neutral-950 p-4 text-white lg:flex">
        {sidebarContent}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open platform navigation"
              onClick={() => setMobileOpen(true)}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white"
            >
              <Menu className="size-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
                Platform Admin
              </p>
              <p className="truncate text-sm font-semibold">{currentLabel}</p>
            </div>
          </div>
          <div className="flex size-9 items-center justify-center rounded-xl bg-neutral-950 text-xs font-semibold text-white">
            {initials(profile?.full_name)}
          </div>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close platform navigation"
              className="absolute inset-0 bg-black/45"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative flex h-full w-[min(86vw,320px)] flex-col bg-neutral-950 p-4 text-white shadow-2xl">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  aria-label="Close platform navigation"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex size-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:text-white"
                >
                  <X className="size-5" />
                </button>
              </div>
              {sidebarContent}
            </aside>
          </div>
        ) : null}

        <main className="min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
