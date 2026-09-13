"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  FileUser,
  Gauge,
  Loader2,
  Settings2,
  Sparkles,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type HRAccess = {
  can_view: boolean;
  can_manage: boolean;
  can_self: boolean;
  can_view_people: boolean;
  can_manage_people: boolean;
  can_invite_employees: boolean;
  can_manage_structure: boolean;
  is_employee: boolean;
  role_name: string | null;
  timezone: string;
  currency: string;
  landing: "overview" | "me" | "unavailable";
};

type Item = { label: string; href: string; icon: LucideIcon; show: boolean };

export function HRModuleNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [access, setAccess] = useState<HRAccess | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/hr/access", { cache: "no-store" });
        if (response.status === 401) { router.replace("/login"); return; }
        if (!response.ok) return;
        const payload = (await response.json()) as HRAccess;
        if (!cancelled) setAccess(payload);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const primary = useMemo<Item[]>(() => [
    { label: "Overview", href: "/dashboard/hr", icon: Gauge, show: Boolean(access?.can_view) },
    { label: "Team", href: "/dashboard/hr/people", icon: UsersRound, show: Boolean(access?.can_view_people) },
    { label: "Time & Leave", href: "/dashboard/hr/time", icon: CalendarClock, show: Boolean(access?.can_view) },
    { label: "My HR & Pay", href: "/dashboard/hr/me", icon: UserRound, show: Boolean(access?.can_self) },
  ].filter(item => item.show), [access]);

  const more = useMemo<Item[]>(() => [
    { label: "Documents & Policies", href: "/dashboard/hr/records", icon: FileUser, show: Boolean(access?.can_view) },
    { label: "Hiring & Reviews", href: "/dashboard/hr/talent", icon: Sparkles, show: Boolean(access?.can_view) },
    { label: "Company HR Setup", href: "/dashboard/hr/settings", icon: Settings2, show: Boolean(access?.can_manage) },
  ].filter(item => item.show), [access]);

  if (loading) return <div className="border-b bg-white px-4 py-3 sm:px-8 lg:px-10"><Loader2 className="size-4 animate-spin text-neutral-400" /></div>;
  const selfServiceOnly = Boolean(access?.can_self) && !access?.can_view && !access?.can_view_people && !access?.can_manage;
  if (selfServiceOnly) return null;
  if (!primary.length && !more.length) return null;

  const active = (href: string) => href === "/dashboard/hr" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const activeMore = more.find(item => active(item.href));

  return <div className="sticky top-16 z-30 border-b border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur lg:top-0 sm:px-8 lg:px-10">
    <div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto">
      <div className="mr-3 hidden shrink-0 border-r pr-4 lg:block"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">People & HR</p></div>
      {primary.map(({ label, href, icon: Icon }) => <Link key={href} href={href} className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${active(href) ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"}`}><Icon className="size-4" />{label}</Link>)}
      {more.length ? <select aria-label="More People and HR pages" value={activeMore?.href ?? ""} onChange={event => { if (event.target.value) router.push(event.target.value); }} className={`h-9 shrink-0 cursor-pointer rounded-lg border-0 px-3 text-sm font-medium outline-none ${activeMore ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-600"}`}><option value="">More…</option>{more.map(item => <option key={item.href} value={item.href}>{item.label}</option>)}</select> : null}
    </div>
  </div>;
}
