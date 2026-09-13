"use client";

import { FileText, Pencil, WalletCards } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

export default function OrderWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ orderId: string }>();
  const pathname = usePathname();
  const orderId = params.orderId;
  const detailPath = `/dashboard/orders/${encodeURIComponent(orderId)}`;
  const commercialPath = `${detailPath}/commercial`;
  const showEditAction = pathname === detailPath;

  return <>
    <div className="border-b bg-white px-5 py-2 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <nav className="flex gap-1" aria-label="Order workspace">
          <Link href={detailPath} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${pathname === detailPath ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"}`}><FileText className="size-4" />Order</Link>
          <Link href={commercialPath} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${pathname.startsWith(commercialPath) ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"}`}><WalletCards className="size-4" />Commercial</Link>
        </nav>
        {showEditAction ? <Link href={`${detailPath}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-800 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"><Pencil className="size-4" />Edit order</Link> : null}
      </div>
    </div>
    {children}
  </>;
}
