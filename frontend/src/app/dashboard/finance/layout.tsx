"use client";

import { usePathname } from "next/navigation";

import { AccountingNav } from "@/components/accounting-nav";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showWorkspaceNavigation = pathname === "/dashboard/finance";

  return (
    <>
      {showWorkspaceNavigation ? (
        <div className="bg-neutral-100 px-4 pt-4 sm:px-7 sm:pt-7 lg:px-9 lg:pt-9">
          <div className="mx-auto max-w-[1500px]">
            <AccountingNav />
          </div>
        </div>
      ) : null}
      {children}
    </>
  );
}
