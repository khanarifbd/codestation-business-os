"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  BookOpenText,
  Building2,
  HandCoins,
  LayoutDashboard,
  Receipt,
  Scale,
  SlidersHorizontal,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  aliases?: string[];
};

const items: Item[] = [
  { label: "Overview", href: "/dashboard/accounting", icon: LayoutDashboard },
  { label: "Accounts", href: "/dashboard/accounting/accounts", icon: WalletCards },
  { label: "Money in", href: "/dashboard/accounting/money-in", icon: ArrowDownLeft },
  { label: "Money out", href: "/dashboard/accounting/money-out", icon: ArrowUpRight },
  {
    label: "Transfers",
    href: "/dashboard/accounting/transfers",
    icon: ArrowLeftRight,
    aliases: ["/dashboard/finance/transfers"],
  },
  { label: "Loans", href: "/dashboard/accounting/loans", icon: HandCoins },
  { label: "Receivables", href: "/dashboard/accounting/receivables", icon: Receipt },
  { label: "Payables", href: "/dashboard/accounting/payables", icon: Building2 },
  { label: "Statements", href: "/dashboard/accounting/reports", icon: BarChart3 },
  { label: "Reconcile", href: "/dashboard/accounting/reconciliation", icon: Scale },
  {
    label: "Controls",
    href: "/dashboard/accounting/controls",
    icon: SlidersHorizontal,
    aliases: ["/dashboard/finance/controls"],
  },
  { label: "Accounting", href: "/dashboard/accounting/advanced", icon: BookOpenText },
];

function isActive(pathname: string, item: Item) {
  if (item.href === "/dashboard/accounting") return pathname === item.href;
  return [item.href, ...(item.aliases ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

export function AccountingNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-1 sm:px-1" aria-label="Finance workspace navigation">
      <nav className="flex min-w-max items-center gap-1 rounded-2xl border border-neutral-200/90 bg-white p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        {items.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          const warmRoute = () => router.prefetch(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onMouseEnter={warmRoute}
              onFocus={warmRoute}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium transition",
                active
                  ? "bg-neutral-950 text-white shadow-sm"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950",
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
