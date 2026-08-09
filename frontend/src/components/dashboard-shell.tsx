"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRightLeft, BadgeDollarSign, Banknote, BarChart3, Bell, BriefcaseBusiness, Building2,
  CalendarRange, CircleDollarSign, ClipboardList, FileClock, FileText, FolderKanban,
  HandCoins, LayoutDashboard, LogOut, Menu, ReceiptText, Settings, SlidersHorizontal, Users, UsersRound, X, Zap,
  type LucideIcon,
} from "lucide-react";

type NavigationItem = { label: string; icon: LucideIcon; href: string };
const navigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "My Work", icon: BriefcaseBusiness, href: "/dashboard/my-work" },
  { label: "My HR", icon: BriefcaseBusiness, href: "/dashboard/my-hr" },
  { label: "Notifications", icon: Bell, href: "/dashboard/notifications" },
  { label: "CRM", icon: ClipboardList, href: "/dashboard/crm" },
  { label: "Clients", icon: Users, href: "/dashboard/clients" },
  { label: "Quotations", icon: FileText, href: "/dashboard/quotations" },
  { label: "Orders", icon: ReceiptText, href: "/dashboard/orders" },
  { label: "Projects", icon: FolderKanban, href: "/dashboard/projects" },
  { label: "Finance", icon: CircleDollarSign, href: "/dashboard/finance" },
  { label: "Transfers", icon: ArrowRightLeft, href: "/dashboard/finance/transfers" },
  { label: "Finance Controls", icon: CalendarRange, href: "/dashboard/finance/controls" },
  { label: "Auto Expenses", icon: Zap, href: "/dashboard/finance/auto-post" },
  { label: "Expenses", icon: BadgeDollarSign, href: "/dashboard/expenses" },
  { label: "Capital & Funding", icon: HandCoins, href: "/dashboard/capital" },
  { label: "Payroll", icon: Banknote, href: "/dashboard/payroll" },
  { label: "HR Management", icon: UsersRound, href: "/dashboard/hr" },
  { label: "HR Setup", icon: SlidersHorizontal, href: "/dashboard/hr/setup" },
  { label: "HR Operations", icon: BriefcaseBusiness, href: "/dashboard/hr/operations" },
  { label: "Employees", icon: Users, href: "/dashboard/employees" },
  { label: "Reports", icon: BarChart3, href: "/dashboard/reports" },
  { label: "Company", icon: Building2, href: "/dashboard/company" },
  { label: "Activity Logs", icon: FileClock, href: "/dashboard/activity-logs" },
  { label: "Settings", icon: Settings, href: "/dashboard/settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/finance") {
    return pathname === href || (pathname.startsWith(`${href}/`) && !pathname.startsWith("/dashboard/finance/transfers") && !pathname.startsWith("/dashboard/finance/controls") && !pathname.startsWith("/dashboard/finance/auto-post"));
  }
  if (href === "/dashboard/hr") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Navigation({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return <nav className="space-y-1">{navigation.map(({ label, icon: Icon, href }) => {
    const active = isActive(pathname, href);
    return <Link key={label} href={href} onClick={onNavigate} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? "bg-neutral-950 font-medium text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"}`}><Icon className="size-4 shrink-0" /><span>{label}</span></Link>;
  })}</nav>;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => { if (!mobileOpen) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, [mobileOpen]);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }
  return <div className="min-h-screen bg-neutral-100 text-neutral-950 lg:flex">
    <aside className="hidden h-screen w-60 shrink-0 border-r border-neutral-200 bg-white p-4 lg:sticky lg:top-0 lg:flex lg:flex-col"><div className="px-3 py-4"><p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><h1 className="mt-1 text-lg font-semibold">Business OS</h1></div><div className="mt-3 flex-1 overflow-y-auto pb-4"><Navigation pathname={pathname} /></div><button type="button" onClick={logout} className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"><LogOut className="size-4" />Sign out</button></aside>
    <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-white/95 px-4 backdrop-blur lg:hidden"><div><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><p className="text-sm font-semibold">Business OS</p></div><button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} className="flex size-10 items-center justify-center rounded-xl border"><Menu className="size-5" /></button></div>
    {mobileOpen ? <div className="fixed inset-0 z-50 lg:hidden"><button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/35" /><aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-80 flex-col bg-white p-4 shadow-2xl"><div className="flex items-center justify-between px-3 py-3"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><h2 className="mt-1 text-lg font-semibold">Business OS</h2></div><button type="button" onClick={() => setMobileOpen(false)} className="flex size-9 items-center justify-center rounded-lg border"><X className="size-4" /></button></div><div className="mt-2 flex-1 overflow-y-auto pb-4"><Navigation pathname={pathname} onNavigate={() => setMobileOpen(false)} /></div><button type="button" onClick={() => void logout()} className="mt-3 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm text-neutral-600"><LogOut className="size-4" />Sign out</button></aside></div> : null}
    <div className={`min-w-0 flex-1 ${pathname === "/dashboard" ? "[&>main>div>aside]:!hidden [&>main>div]:!max-w-none" : ""}`}>{children}</div>
  </div>;
}
