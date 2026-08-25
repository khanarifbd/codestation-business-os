"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

export default function OrderWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ orderId: string }>();
  const pathname = usePathname();
  const orderId = params.orderId;
  const detailPath = `/dashboard/orders/${encodeURIComponent(orderId)}`;
  const showEditAction = pathname === detailPath;

  return <>
    {showEditAction ? <div className="bg-neutral-100 px-5 pt-5 sm:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl justify-end">
        <Link href={`${detailPath}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-800 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50">
          <Pencil className="size-4" />Edit order
        </Link>
      </div>
    </div> : null}
    {children}
  </>;
}
