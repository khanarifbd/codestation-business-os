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
import { WorkspaceSwitcher, type WorkspaceContext } from "@/components/workspace-switcher";

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
  { label: "Projects", icon: FolderKanban, href: "/dashboard/projects", permissions: ["projects.view"] },
  { label: "Invoices", icon: FileText, href: "/dashboard/accounting/invoices", permissions: ["finance.view"] },
  { label: "Finance & Accounts", icon: BookOpenText, href: "/dashboard/accounting", permissions: ["finance.view", "capital.view"] },
  { label: "People & HR", icon: UsersRound, href: "/dashboard/hr", permissions: ["hr.self", "hr.view"] },
  { label: "Payroll", icon: Banknote, href: "/dashboard/payroll", permissions: ["payroll.view"] },
  { label: "Reports", icon: BarChart3, href: "/dashboard/reports", permissions: ["reports.view"] },
  { label: "Company & Settings", icon: Building2, href: "/dashboard/company", permissions: ["company.view", "settings.manage"] },
  { label: "Activity Logs", icon: FileClock, href: "/dashboard/activity-logs", permissions: ["activity_logs.view"] },
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
  href: "/dashboard/client-portal",
};

function hasAnyPermission(granted: string[], required?: string[]) {
  if (!required?.length) return true;
  if (granted.includes("*")) return true;
  return required.some((permission) => granted.includes(permission));
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
  if (href === "/dashboard/accounting/invoices") {
    return pathname.startsWith("/dashboard/accounting/invoices");
  }
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
  return parts.length
    ? parts
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("")
    : "U";
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
  const financeActive = isFinanceArea(pathname);
  const [financeOpen, setFinanceOpen] = useState(financeActive);

  useEffect(() => {
    if (financeActive) setFinanceOpen(true);
  }, [financeActive]);

  const visibleItems = items.filter((item) => hasAnyPermission(permissions, item.permissions));
  const visibleFinanceItems = financeNavigation.filter((item) =>
    hasAnyPermission(permissions, item.permissions),
  );

  return (
    <nav className="space-y-1">
      {visibleItems.map(({ label, icon: Icon, href }) => {
        if (label === "Finance & Accounts") {
          if (!visibleFinanceItems.length) return null;
          return (
            <div key={label}>
              <button
                type="button"
                aria-expanded={financeOpen}
                onClick={() => setFinanceOpen((value) => !value)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  financeActive
                    ? "bg-neutral-950 font-medium text-white"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">{label}</span>
                <ChevronDown
                  className={`size-4 shrink-0 transition-transform ${financeOpen ? "rotate-180" : ""}`}
                />
              </button>
              {financeOpen ? (
                <div className="ml-5 mt-1 space-y-0.5 border-l border-neutral-200 pl-2">
                  {visibleFinanceItems.map(({ label: childLabel, icon: ChildIcon, href: childHref }) => {
                    const childActive = isFinanceItemActive(pathname, childHref);
                    return (
                      <Link
                        key={childLabel}
                        href={childHref}
                        onClick={onNavigate}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                          childActive
                            ? "bg-neutral-100 font-medium text-neutral-950"
                            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
                        }`}
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
            onClick={onNavigate}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
              active
                ? "bg-neutral-950 font-medium text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
            }`}
          >
            <Icon className="size-4 shrink-0" />
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
      className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${
        active
          ? "border-neutral-950 bg-neutral-950 text-white"
          : "border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50"
      }`}
    >
      <div
        className={`flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold ${
          active ? "bg-white/10 text-white" : "bg-neutral-950 text-white"
        }`}
      >
        {profile?.has_avatar ? (
          <img
            src={`/api/profile/avatar?v=${profile.avatar_version}`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : profile ? (
          profileInitials(profile.full_name)
        ) : (
          "ME"
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{profile?.full_name ?? "My profile"}</p>
        <p className={`truncate text-[11px] ${active ? "text-white/55" : "text-neutral-400"}`}>
          {profile?.email ?? "Account & security"}
        </p>
      </div>
      <ChevronDown className="size-3.5 -rotate-90 opacity-45" />
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 backdrop-blur lg:hidden"
    >
      <div
        className="grid min-h-16 items-stretch px-1"
        style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      >
        {items.map(({ label, icon: Icon, href }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={`${label}-${href}`}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition ${
                active ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-700"
              }`}
            >
              <span
                className={`flex size-8 items-center justify-center rounded-xl transition ${
                  active ? "bg-neutral-950 text-white" : "bg-transparent"
                }`}
              >
                <Icon className="size-[18px]" />
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
          className={`flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition ${
            moreActive ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-700"
          }`}
        >
          <span
            className={`flex size-8 items-center justify-center rounded-xl transition ${
              moreActive ? "bg-neutral-950 text-white" : "bg-transparent"
            }`}
          >
            <Menu className="size-[18px]" />
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
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContext | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);

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

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const response = await fetch("/api/profile", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json().catch(() => null);
      if (active && payload?.full_name && payload?.email) {
        setProfile({
          full_name: payload.full_name,
          email: payload.email,
          has_avatar: Boolean(payload.has_avatar),
          avatar_version: Number(payload.avatar_version ?? 0),
        });
      }
    }

    const refresh = () => {
      void loadProfile();
    };

    void loadProfile();
    window.addEventListener("business-os-profile-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("business-os-profile-updated", refresh);
    };
  }, []);

  const relationships = workspaceContext?.relationships ?? [];
  const clientOnly = workspaceContext?.primary_relationship === "client";
  const hasClientRelationship = relationships.includes("client");
  const permissions = workspaceContext?.permissions ?? [];

  useEffect(() => {
    if (
      clientOnly &&
      pathname !== "/dashboard/client-portal" &&
      !pathname.startsWith("/dashboard/profile")
    ) {
      router.replace("/dashboard/client-portal");
    }
  }, [clientOnly, pathname, router]);

  const navigation = useMemo(() => {
    if (clientOnly) return [clientPortalItem];
    const items = [...staffNavigation];
    if (hasClientRelationship) items.splice(1, 0, clientPortalItem);
    return items;
  }, [clientOnly, hasClientRelationship]);

  const mobilePrimaryNavigation = useMemo<NavigationItem[]>(() => {
    if (clientOnly) {
      return [
        { label: "Portal", icon: Building2, href: "/dashboard/client-portal" },
        { label: "Profile", icon: UserRound, href: "/dashboard/profile" },
      ];
    }

    const items: NavigationItem[] = [];
    const add = (item: NavigationItem | null) => {
      if (!item || !hasAnyPermission(permissions, item.permissions)) return;
      if (items.some((existing) => existing.href === item.href)) return;
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
      add({
        label: "Finance",
        icon: WalletCards,
        href: "/dashboard/accounting",
        permissions: ["finance.view", "capital.view"],
      });
    } else {
      add({ label: "Reports", icon: BarChart3, href: "/dashboard/reports", permissions: ["reports.view"] });
    }

    return items.slice(0, 4);
  }, [clientOnly, permissions]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (pathname.endsWith("/print")) return <>{children}</>;

  const profileActive = pathname.startsWith("/dashboard/profile");

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-950 lg:flex">
      <aside className="hidden h-screen w-64 shrink-0 border-r border-neutral-200 bg-white p-4 lg:sticky lg:top-0 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-3 py-4">
          <div className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
            <BrandMark className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
            <h1 className="mt-0.5 text-lg font-semibold">Business OS</h1>
          </div>
        </div>
        <div className="px-1 pb-4">
          <WorkspaceSwitcher onContextChange={setWorkspaceContext} />
        </div>
        <div className="mt-1 flex-1 overflow-y-auto pb-4">
          <Navigation pathname={pathname} items={navigation} permissions={permissions} />
        </div>
        <div className="space-y-2 border-t pt-3">
          <ProfileLink profile={profile} active={profileActive} />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-white/95 px-4 backdrop-blur lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white p-2">
            <BrandMark className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
            <p className="max-w-[190px] truncate text-sm font-semibold">
              {workspaceContext?.organization.name ?? "Business OS"}
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Open app drawer"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
          className="flex size-10 items-center justify-center rounded-xl border"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close app drawer"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/35"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[88vw] max-w-96 flex-col bg-white p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
            <div className="flex items-center justify-between px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white p-2">
                  <BrandMark className="h-full w-full object-contain" />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p>
                  <h2 className="mt-0.5 text-lg font-semibold">Business OS</h2>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close app drawer"
                onClick={() => setMobileOpen(false)}
                className="flex size-9 items-center justify-center rounded-lg border"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="px-1 pb-4">
              <WorkspaceSwitcher onContextChange={setWorkspaceContext} />
            </div>
            <div className="mt-2 flex-1 overflow-y-auto pb-4">
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">All apps</p>
              <Navigation
                pathname={pathname}
                items={navigation}
                permissions={permissions}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            <div className="space-y-2 border-t pt-3">
              <ProfileLink
                profile={profile}
                active={profileActive}
                onNavigate={() => setMobileOpen(false)}
              />
              <button
                type="button"
                onClick={() => void logout()}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div
        className={`min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 ${
          pathname === "/dashboard"
            ? "[&>main>div>aside]:!hidden [&>main>div]:!max-w-none"
            : ""
        }`}
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
