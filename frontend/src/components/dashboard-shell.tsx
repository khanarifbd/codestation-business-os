"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Banknote, BarChart3, Bell, BookOpenText, BriefcaseBusiness, Building2, ClipboardList, FileClock, FileText,
  FolderKanban, LayoutDashboard, LogOut, Menu, ReceiptText, Settings, SlidersHorizontal, Users, UsersRound, X,
  type LucideIcon,
} from "lucide-react";

import { WorkspaceSwitcher, type WorkspaceContext } from "@/components/workspace-switcher";

type NavigationItem = { label: string; icon: LucideIcon; href: string };
const staffNavigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "My Work", icon: BriefcaseBusiness, href: "/dashboard/my-work" },
  { label: "My HR", icon: BriefcaseBusiness, href: "/dashboard/my-hr" },
  { label: "Notifications", icon: Bell, href: "/dashboard/notifications" },
  { label: "CRM", icon: ClipboardList, href: "/dashboard/crm" },
  { label: "Clients", icon: Users, href: "/dashboard/clients" },
  { label: "Quotations", icon: FileText, href: "/dashboard/quotations" },
  { label: "Orders", icon: ReceiptText, href: "/dashboard/orders" },
  { label: "Projects", icon: FolderKanban, href: "/dashboard/projects" },
  { label: "Invoices", icon: FileText, href: "/dashboard/accounting/invoices" },
  { label: "Finance & Accounts", icon: BookOpenText, href: "/dashboard/accounting" },
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
const clientPortalItem: NavigationItem = { label: "Client Portal", icon: Building2, href: "/dashboard/client-portal" };

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/accounting/invoices") return pathname.startsWith("/dashboard/accounting/invoices");
  if (href === "/dashboard/accounting") {
    if (pathname.startsWith("/dashboard/accounting/invoices")) return false;
    return pathname.startsWith("/dashboard/accounting") || pathname.startsWith("/dashboard/finance") || pathname.startsWith("/dashboard/expenses") || pathname.startsWith("/dashboard/capital");
  }
  if (href === "/dashboard/hr") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Navigation({ pathname, items, onNavigate }: { pathname: string; items: NavigationItem[]; onNavigate?: () => void }) {
  return <nav className="space-y-1">{items.map(({ label, icon: Icon, href }) => {
    const active = isActive(pathname, href);
    return <Link key={label} href={href} onClick={onNavigate} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? "bg-neutral-950 font-medium text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"}`}><Icon className="size-4 shrink-0" /><span>{label}</span></Link>;
  })}</nav>;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);

  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => { if (!mobileOpen) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, [mobileOpen]);

  const relationships = workspaceContext?.relationships ?? [];
  const clientOnly = workspaceContext?.primary_relationship === "client";
  const hasClientRelationship = relationships.includes("client");

  useEffect(() => {
    if (clientOnly && pathname !== "/dashboard/client-portal") {
      router.replace("/dashboard/client-portal");
    }
  }, [clientOnly, pathname, router]);

  const navigation = useMemo(() => {
    if (clientOnly) return [clientPortalItem];
    const items = [...staffNavigation];
    if (hasClientRelationship) items.splice(1, 0, clientPortalItem);
    return items;
  }, [clientOnly, hasClientRelationship]);

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }

  return <div className="min-h-screen bg-neutral-100 text-neutral-950 lg:flex">
    <aside className="hidden h-screen w-64 shrink-0 border-r border-neutral-200 bg-white p-4 lg:sticky lg:top-0 lg:flex lg:flex-col">
      <div className="px-3 py-4"><p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><h1 className="mt-1 text-lg font-semibold">Business OS</h1></div>
      <div className="px-1 pb-4"><WorkspaceSwitcher onContextChange={setWorkspaceContext} /></div>
      <div className="mt-1 flex-1 overflow-y-auto pb-4"><Navigation pathname={pathname} items={navigation} /></div>
      <button type="button" onClick={logout} className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"><LogOut className="size-4" />Sign out</button>
    </aside>

    <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-white/95 px-4 backdrop-blur lg:hidden"><div><p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><p className="max-w-[220px] truncate text-sm font-semibold">{workspaceContext?.organization.name ?? "Business OS"}</p></div><button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} className="flex size-10 items-center justify-center rounded-xl border"><Menu className="size-5" /></button></div>

    {mobileOpen ? <div className="fixed inset-0 z-50 lg:hidden"><button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute inset-0 bg-black/35" /><aside className="absolute inset-y-0 left-0 flex w-[88vw] max-w-96 flex-col bg-white p-4 shadow-2xl"><div className="flex items-center justify-between px-3 py-3"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><h2 className="mt-1 text-lg font-semibold">Business OS</h2></div><button type="button" onClick={() => setMobileOpen(false)} className="flex size-9 items-center justify-center rounded-lg border"><X className="size-4" /></button></div><div className="px-1 pb-4"><WorkspaceSwitcher onContextChange={setWorkspaceContext} /></div><div className="mt-2 flex-1 overflow-y-auto pb-4"><Navigation pathname={pathname} items={navigation} onNavigate={() => setMobileOpen(false)} /></div><button type="button" onClick={() => void logout()} className="mt-3 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm text-neutral-600"><LogOut className="size-4" />Sign out</button></aside></div> : null}

    <div className={`min-w-0 flex-1 ${pathname === "/dashboard" ? "[&>main>div>aside]:!hidden [&>main>div]:!max-w-none" : ""}`}>{children}</div>
  </div>;
}
