"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  Bell,
  BookOpenText,
  Boxes,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ClipboardList,
  FileClock,
  FileText,
  FolderKanban,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  ReceiptText,
  Scale,
  TrendingUp,
  UserRound,
  Users,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { useDashboardSession, type WorkspaceContext } from "@/components/dashboard-session-context";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { cn } from "@/lib/cn";

type NavigationItem = {
  label: string;
  icon: LucideIcon;
  href: string;
  permissions?: string[];
};

type ProfileSummary = {
  full_name: string;
  email: string;
  has_avatar: boolean;
  avatar_version: number;
};

const staffNavigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", permissions: ["dashboard.view"] },
  { label: "My Work", icon: BriefcaseBusiness, href: "/dashboard/my-work", permissions: ["projects.work"] },
  { label: "Notifications", icon: Bell, href: "/dashboard/notifications", permissions: ["projects.work"] },
  { label: "CRM", icon: ClipboardList, href: "/dashboard/crm", permissions: ["crm.view"] },
  { label: "Clients", icon: Users, href: "/dashboard/clients", permissions: ["clients.view"] },
  { label: "Quotations", icon: FileText, href: "/dashboard/quotations", permissions: ["quotations.view"] },
  { label: "Orders", icon: ReceiptText, href: "/dashboard/orders", permissions: ["orders.view"] },
  { label: "Inventory", icon: Boxes, href: "/dashboard/inventory", permissions: ["finance.view"] },
  { label: "Projects", icon: FolderKanban, href: "/dashboard/projects", permissions: ["projects.view", "projects.work"] },
  { label: "Invoices", icon: FileText, href: "/dashboard/accounting/invoices", permissions: ["finance.view"] },
  { label: "Finance & Accounts", icon: BookOpenText, href: "/dashboard/accounting", permissions: ["finance.view", "capital.view"] },
  { label: "People & HR", icon: UsersRound, href: "/dashboard/hr", permissions: ["hr.self", "hr.view"] },
  { label: "Payroll", icon: Banknote, href: "/dashboard/payroll", permissions: ["payroll.view"] },
  { label: "Reports", icon: BarChart3, href: "/dashboard/reports", permissions: ["reports.view"] },
  { label: "Company & Settings", icon: Building2, href: "/dashboard/company", permissions: ["company.view", "settings.manage"] },
  { label: "Activity Logs", icon: FileClock, href: "/dashboard/activity-logs", permissions: ["activity_logs.view"] },
];

const employeeNavigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard/employee" },
  { label: "My Work", icon: BriefcaseBusiness, href: "/dashboard/my-work", permissions: ["projects.work"] },
  { label: "Projects", icon: FolderKanban, href: "/dashboard/projects", permissions: ["projects.work"] },
  { label: "My HR & Pay", icon: UserRound, href: "/dashboard/hr/me", permissions: ["hr.self"] },
  { label: "Notifications", icon: Bell, href: "/dashboard/notifications", permissions: ["projects.work"] },
];

const clientNavigation: NavigationItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard/client" },
  { label: "Projects", icon: FolderKanban, href: "/dashboard/client/projects" },
  { label: "Orders", icon: ReceiptText, href: "/dashboard/client/orders" },
  { label: "Quotations", icon: FileText, href: "/dashboard/client/quotations" },
  { label: "Invoices", icon: Receipt, href: "/dashboard/client/invoices" },
];

const employeeExpandedWorkspacePermissions = [
  "crm.view",
  "clients.view",
  "quotations.view",
  "orders.view",
  "finance.view",
  "capital.view",
  "payroll.view",
  "reports.view",
  "company.view",
  "settings.manage",
  "activity_logs.view",
  "hr.view",
  "employees.view",
  "employees.manage",
];

const financeNavigation: NavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/dashboard/accounting", permissions: ["finance.view"] },
  { label: "Accounts", icon: WalletCards, href: "/dashboard/accounting/accounts", permissions: ["finance.view"] },
  { label: "Money In", icon: ArrowDownLeft, href: "/dashboard/accounting/money-in", permissions: ["finance.view"] },
  { label: "Money Out", icon: ArrowUpRight, href: "/dashboard/accounting/money-out", permissions: ["finance.view"] },
  { label: "Expenses", icon: ReceiptText, href: "/dashboard/expenses", permissions: ["finance.view"] },
  { label: "Transfers", icon: ArrowLeftRight, href: "/dashboard/accounting/transfers", permissions: ["finance.view"] },
  { label: "Reconcile", icon: Scale, href: "/dashboard/accounting/reconciliation", permissions: ["finance.view"] },
  { label: "Loans", icon: HandCoins, href: "/dashboard/accounting/loans", permissions: ["finance.view"] },
  { label: "Investments", icon: TrendingUp, href: "/dashboard/capital", permissions: ["capital.view"] },
  { label: "Assets", icon: Boxes, href: "/dashboard/accounting/assets", permissions: ["finance.view"] },
  { label: "Receivables", icon: Receipt, href: "/dashboard/accounting/receivables", permissions: ["finance.view"] },
  { label: "Payables", icon: Building2, href: "/dashboard/accounting/payables", permissions: ["finance.view"] },
  { label: "Tax", icon: Landmark, href: "/dashboard/accounting/tax", permissions: ["finance.view"] },
  { label: "Financial statements", icon: BarChart3, href: "/dashboard/accounting/reports", permissions: ["finance.view"] },
  { label: "Advanced", icon: BookOpenText, href: "/dashboard/accounting/advanced", permissions: ["finance.view"] },
];

const clientPortalItem: NavigationItem = {
  label: "Client Portal",
  icon: Building2,
  href: "/dashboard/client",
};

function hasAnyPermission(granted: string[], required?: string[]) {
  if (!required?.length) return true;
  if (granted.includes("*")) return true;
  return required.some((permission) => granted.includes(permission));
}

function isEmployeeSelfServiceContext(context: WorkspaceContext | null) {
  if (!context || context.primary_relationship !== "employee" || context.is_owner) return false;
  const permissions = context.permissions ?? [];
  if (permissions.includes("*")) return false;
  return !hasAnyPermission(permissions, employeeExpandedWorkspacePermissions);
}

function isFinanceArea(pathname: string) {
  if (pathname.startsWith("/dashboard/accounting/invoices")) return false;
  return (
    pathname.startsWith("/dashboard/accounting") ||
    pathname.startsWith("/dashboard/finance") ||
    pathname.startsWith("/dashboard/expenses") ||
    pathname.startsWith("/dashboard/capital")
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/dashboard/client") return pathname === href || pathname === "/dashboard/client-portal";
  if (href === "/dashboard/accounting/invoices") return pathname.startsWith("/dashboard/accounting/invoices");
  if (href === "/dashboard/accounting") return isFinanceArea(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isFinanceItemActive(pathname: string, href: string) {
  if (href === "/dashboard/accounting") return pathname === href;
  if (href === "/dashboard/accounting/transfers") {
    return pathname.startsWith(href) || pathname.startsWith("/dashboard/finance/transfers");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") : "U";
}

function Navigation({
  pathname,
  items,
  permissions,
  onNavigate,
}: {
  pathname: string;
  items: NavigationItem[];
  permissions: string[];
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const financeActive = isFinanceArea(pathname);
  const [financeOpen, setFinanceOpen] = useState(financeActive);

  useEffect(() => {
    if (financeActive) setFinanceOpen(true);
  }, [financeActive]);

  const visibleItems = items.filter((item) => hasAnyPermission(permissions, item.permissions));
  const visibleFinanceItems = financeNavigation.filter((item) => hasAnyPermission(permissions, item.permissions));

  return (
    <nav className="space-y-1" aria-label="Workspace navigation">
      {visibleItems.map(({ label, icon: Icon, href }) => {
        if (label === "Finance & Accounts") {
          if (!visibleFinanceItems.length) return null;
          return (
            <div key={label}>
              <button
                type="button"
                aria-expanded={financeOpen}
                onClick={() => setFinanceOpen((value) => !value)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition",
                  financeActive
                    ? "bg-neutral-950 text-white shadow-sm"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg transition",
                    financeActive ? "bg-white/10" : "bg-neutral-100 text-neutral-500 group-hover:text-neutral-800",
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronDown className={cn("size-3.5 shrink-0 opacity-60 transition-transform", financeOpen && "rotate-180")} />
              </button>

              {financeOpen ? (
                <div className="ml-[1.35rem] mt-1.5 space-y-0.5 border-l border-neutral-200 pl-3">
                  {visibleFinanceItems.map(({ label: childLabel, icon: ChildIcon, href: childHref }) => {
                    const childActive = isFinanceItemActive(pathname, childHref);
                    return (
                      <Link
                        key={childLabel}
                        href={childHref}
                        onMouseEnter={() => router.prefetch(childHref)}
                        onFocus={() => router.prefetch(childHref)}
                        onClick={onNavigate}
                        aria-current={childActive ? "page" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition",
                          childActive
                            ? "bg-neutral-100 font-semibold text-neutral-950"
                            : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900",
                        )}
                      >
                        <ChildIcon className="size-3.5 shrink-0" />
                        <span>{childLabel}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        }

        const active = isActive(pathname, href);
        return (
          <Link
            key={label}
            href={href}
            onMouseEnter={() => router.prefetch(href)}
            onFocus={() => router.prefetch(href)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition",
              active
                ? "bg-neutral-950 text-white shadow-sm"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg transition",
                active ? "bg-white/10" : "bg-neutral-100 text-neutral-500 group-hover:text-neutral-800",
              )}
            >
              <Icon className="size-3.5" />
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ProfileLink({
  profile,
  active,
  onNavigate,
}: {
  profile: ProfileSummary | null;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href="/dashboard/profile"
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-2.5 transition",
        active
          ? "border-neutral-950 bg-neutral-950 text-white"
          : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50",
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold",
          active ? "bg-white/10 text-white" : "bg-neutral-950 text-white",
        )}
      >
        {profile?.has_avatar ? (
          <img src={`/api/profile/avatar?v=${profile.avatar_version}`} alt="" className="h-full w-full object-cover" />
        ) : profile ? (
          profileInitials(profile.full_name)
        ) : (
          "ME"
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{profile?.full_name ?? "My profile"}</p>
        <p className={cn("truncate text-[11px]", active ? "text-white/55" : "text-neutral-400")}>
          {profile?.email ?? "Account & security"}
        </p>
      </div>
      <ChevronDown className="size-3.5 -rotate-90 opacity-40" />
    </Link>
  );
}

function MobileBottomNavigation({
  pathname,
  items,
  drawerOpen,
  onOpenDrawer,
}: {
  pathname: string;
  items: NavigationItem[];
  drawerOpen: boolean;
  onOpenDrawer: () => void;
}) {
  const hasPrimaryActive = items.some((item) => isActive(pathname, item.href));
  const moreActive = drawerOpen || !hasPrimaryActive;

  return (
    <nav
      aria-label="Mobile primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200/90 bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl lg:hidden"
    >
      <div
        className="grid min-h-[62px] items-stretch px-1.5"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      >
        {items.map(({ label, icon: Icon, href }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={`${label}-${href}`}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-semibold transition",
                active ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-700",
              )}
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl transition",
                  active ? "bg-neutral-950 text-white shadow-sm" : "bg-transparent",
                )}
              >
                <Icon className="size-[17px]" />
              </span>
              <span className="max-w-full truncate">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-label="Open app drawer"
          aria-expanded={drawerOpen}
          onClick={onOpenDrawer}
          className={cn(
            "flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-semibold transition",
            moreActive ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-700",
          )}
        >
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-xl transition",
              moreActive ? "bg-neutral-950 text-white shadow-sm" : "bg-transparent",
            )}
          >
            <Menu className="size-[17px]" />
          </span>
          <span>More</span>
        </button>
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { profile, tenant: workspaceContext } = useDashboardSession();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const relationships = workspaceContext?.relationships ?? [];
  const clientOnly = workspaceContext?.primary_relationship === "client";
  const employeeSelfService = isEmployeeSelfServiceContext(workspaceContext);
  const hasClientRelationship = relationships.includes("client");
  const permissions = workspaceContext?.permissions ?? [];
  const clientLanding = "/dashboard/client";
  const employeeLanding = "/dashboard/employee";
  const clientArea =
    pathname === clientLanding ||
    pathname.startsWith(`${clientLanding}/`) ||
    pathname === "/dashboard/client-portal";

  useEffect(() => {
    if (clientOnly && !clientArea && !pathname.startsWith("/dashboard/profile")) {
      router.replace(clientLanding);
      return;
    }
    if (employeeSelfService && pathname === "/dashboard") {
      router.replace(employeeLanding);
    }
  }, [clientArea, clientLanding, clientOnly, employeeLanding, employeeSelfService, pathname, router]);

  const navigation = useMemo(() => {
    if (clientOnly) return clientNavigation;
    if (employeeSelfService) return employeeNavigation;
    const items = [...staffNavigation];
    if (hasClientRelationship) items.splice(1, 0, clientPortalItem);
    return items;
  }, [clientOnly, employeeSelfService, hasClientRelationship]);

  const mobilePrimaryNavigation = useMemo<NavigationItem[]>(() => {
    if (clientOnly) return clientNavigation.slice(0, 4);
    if (employeeSelfService) {
      return employeeNavigation.filter((item) => hasAnyPermission(permissions, item.permissions)).slice(0, 3);
    }

    const items: NavigationItem[] = [];
    const add = (item: NavigationItem | null) => {
      if (!item || !hasAnyPermission(permissions, item.permissions) || items.some((existing) => existing.href === item.href)) return;
      items.push(item);
    };

    add({ label: "Home", icon: LayoutDashboard, href: "/dashboard", permissions: ["dashboard.view"] });
    if (hasAnyPermission(permissions, ["projects.work"])) {
      add({ label: "Work", icon: BriefcaseBusiness, href: "/dashboard/my-work", permissions: ["projects.work"] });
    } else {
      add({ label: "Projects", icon: FolderKanban, href: "/dashboard/projects", permissions: ["projects.view"] });
    }

    if (hasAnyPermission(permissions, ["clients.view"])) {
      add({ label: "Clients", icon: Users, href: "/dashboard/clients", permissions: ["clients.view"] });
    } else if (hasAnyPermission(permissions, ["crm.view"])) {
      add({ label: "CRM", icon: ClipboardList, href: "/dashboard/crm", permissions: ["crm.view"] });
    } else {
      add({ label: "Orders", icon: ReceiptText, href: "/dashboard/orders", permissions: ["orders.view"] });
    }

    if (hasAnyPermission(permissions, ["finance.view", "capital.view"])) {
      add({ label: "Finance", icon: WalletCards, href: "/dashboard/accounting", permissions: ["finance.view", "capital.view"] });
    } else {
      add({ label: "Reports", icon: BarChart3, href: "/dashboard/reports", permissions: ["reports.view"] });
    }

    return items.slice(0, 4);
  }, [clientOnly, employeeSelfService, permissions]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (pathname.endsWith("/print")) return <>{children}</>;

  const profileActive = pathname.startsWith("/dashboard/profile");
  const portalLabel = employeeSelfService ? "Employee Portal" : clientOnly ? "Client Portal" : "Business OS";
  const navLabel = employeeSelfService ? "My workspace" : clientOnly ? "Client workspace" : "Workspace";

  return (
    <div className="min-h-screen bg-[var(--app-canvas)] text-neutral-950 lg:flex">
      <aside className="hidden h-screen w-[280px] shrink-0 border-r border-neutral-200/90 bg-white px-3 pb-3 pt-4 lg:sticky lg:top-0 lg:flex lg:flex-col">
        <div className="px-2">
          <div className="flex items-center gap-3 px-1 py-2">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
              <BrandMark className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
              <h1 className="mt-0.5 truncate text-[17px] font-semibold tracking-tight">{portalLabel}</h1>
            </div>
          </div>
          <div className="mt-3">
            <WorkspaceSwitcher />
          </div>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-1 pb-4 [scrollbar-width:thin]">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{navLabel}</p>
          <Navigation pathname={pathname} items={navigation} permissions={permissions} />
        </div>

        <div className="space-y-2 border-t border-neutral-100 px-1 pt-3">
          <ProfileLink profile={profile} active={profileActive} />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-neutral-100">
              <LogOut className="size-3.5" />
            </span>
            Sign out
          </button>
        </div>
      </aside>

      <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-neutral-200/90 bg-white/95 px-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)] backdrop-blur-xl lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
            <BrandMark className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-neutral-400">{portalLabel}</p>
            <p className="max-w-[210px] truncate text-sm font-semibold tracking-tight">
              {workspaceContext?.organization.name ?? "CodeStation AI"}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Open app drawer"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-700 shadow-sm transition hover:bg-neutral-50"
        >
          <Menu className="size-4.5" />
        </button>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close app drawer"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/35 backdrop-blur-[1px]"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[88vw] max-w-[390px] flex-col bg-white px-3 pb-4 pt-3 shadow-2xl">
            <div className="flex items-center justify-between px-2 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
                  <BrandMark className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
                  <h2 className="mt-0.5 truncate text-base font-semibold tracking-tight">{portalLabel}</h2>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close app drawer"
                onClick={() => setMobileOpen(false)}
                className="flex size-9 items-center justify-center rounded-xl border border-neutral-200 bg-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-2 px-2">
              <WorkspaceSwitcher />
            </div>

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-1 pb-4">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{navLabel}</p>
              <Navigation
                pathname={pathname}
                items={navigation}
                permissions={permissions}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>

            <div className="space-y-2 border-t border-neutral-100 px-1 pt-3">
              <ProfileLink profile={profile} active={profileActive} onNavigate={() => setMobileOpen(false)} />
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-neutral-600 transition hover:bg-neutral-100"
              >
                <span className="flex size-7 items-center justify-center rounded-lg bg-neutral-100">
                  <LogOut className="size-3.5" />
                </span>
                Sign out
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div
        className={cn(
          "min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0",
          pathname === "/dashboard" && "[&>main>div>aside]:!hidden [&>main>div]:!max-w-none",
        )}
      >
        {children}
      </div>

      <MobileBottomNavigation
        pathname={pathname}
        items={mobilePrimaryNavigation}
        drawerOpen={mobileOpen}
        onOpenDrawer={() => setMobileOpen(true)}
      />
    </div>
  );
}
