"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen, Building2, FileText, HandCoins, LayoutDashboard, Receipt, WalletCards } from "lucide-react";

const items = [
  { label: "Overview", href: "/dashboard/accounting", icon: LayoutDashboard },
  { label: "Accounts", href: "/dashboard/accounting/accounts", icon: WalletCards },
  { label: "Money In", href: "/dashboard/accounting/money-in", icon: ArrowDownLeft },
  { label: "Money Out", href: "/dashboard/accounting/money-out", icon: ArrowUpRight },
  { label: "Transfers", href: "/dashboard/finance/transfers", icon: ArrowLeftRight },
  { label: "Loans", href: "/dashboard/accounting/loans", icon: HandCoins },
  { label: "Receivables", href: "/dashboard/accounting/receivables", icon: Receipt },
  { label: "Payables", href: "/dashboard/accounting/payables", icon: Building2 },
  { label: "Reports", href: "/dashboard/reports", icon: FileText },
  { label: "Advanced", href: "/dashboard/accounting/advanced", icon: BookOpen },
  { label: "Finance", href: "/dashboard/finance", icon: FileText },
];

export function AccountingNav() {
  const pathname = usePathname();
  return (
    <div className="overflow-x-auto pb-1">
      <nav className="flex min-w-max gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5">
        {items.map(({ label, href, icon: Icon }) => {
          let active = href === "/dashboard/accounting" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          if (href === "/dashboard/finance") {
            active = pathname === "/dashboard/finance";
          }
          return <Link key={label} href={href} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${active ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"}`}><Icon className="size-4" /><span>{label}</span></Link>;
        })}
      </nav>
    </div>
  );
}
