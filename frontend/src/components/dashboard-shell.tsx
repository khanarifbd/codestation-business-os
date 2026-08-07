"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  CircleDollarSign,
  ClipboardList,
  FileClock,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  href?: string;
};

const navigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
  { label: "CRM", icon: ClipboardList, href: "/dashboard/crm" },
  { label: "Clients", icon: Users, href: "/dashboard/clients" },
  { label: "Orders", icon: ReceiptText },
  { label: "Projects", icon: FolderKanban },
  { label: "Finance", icon: CircleDollarSign },
  { label: "Employees", icon: UsersRound, href: "/dashboard/employees" },
  { label: "Reports", icon: BarChart3 },
  { label: "Company", icon: Building2, href: "/dashboard/company" },
  { label: "Activity Logs", icon: FileClock, href: "/dashboard/activity-logs" },
  { label: "Settings", icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-950 lg:flex">
      <aside className="hidden h-screen w-60 shrink-0 border-r border-neutral-200 bg-white p-4 lg:sticky lg:top-0 lg:flex lg:flex-col">
        <div className="px-3 py-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
          <h1 className="mt-1 text-lg font-semibold">Business OS</h1>
        </div>

        <nav className="mt-3 space-y-1 overflow-y-auto pb-4">
          {navigation.map(({ label, icon: Icon, href }) => {
            const active =
              href === "/dashboard"
                ? pathname === "/dashboard"
                : href
                  ? pathname === href || pathname.startsWith(`${href}/`)
                  : false;
            const className = `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
              active
                ? "bg-neutral-950 font-medium text-white"
                : href
                  ? "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
                  : "cursor-default text-neutral-300"
            }`;

            return href ? (
              <Link key={label} href={href} className={className}>
                <Icon className="size-4" />
                {label}
              </Link>
            ) : (
              <div key={label} className={className} title="Coming soon">
                <Icon className="size-4" />
                {label}
              </div>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </aside>

      <div
        className={`min-w-0 flex-1 ${
          pathname === "/dashboard"
            ? "[&>main>div>aside]:!hidden [&>main>div]:!max-w-none"
            : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}
