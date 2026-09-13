import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

export function formatPortalMoney(value: string | number, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPortalDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value.length === 10 ? `${value}T00:00:00` : value}`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function portalStatusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ClientPortalStatusBadge({ status }: { status: string }) {
  return <span className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-700">{portalStatusLabel(status)}</span>;
}

export function ClientPortalPageHeader({ title, description, backHref }: { title: string; description: string; backHref?: string }) {
  return <header>
    {backHref ? <Link href={backHref} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-neutral-500 transition hover:text-neutral-950"><ArrowLeft className="size-4" />Back</Link> : null}
    <p className="text-sm font-medium text-neutral-500">Client portal</p>
    <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
    <p className="mt-2 max-w-2xl text-sm text-neutral-500">{description}</p>
  </header>;
}

export function ClientPortalLoading() {
  return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="size-7 animate-spin text-neutral-400" /></main>;
}

export function ClientPortalError({ message }: { message: string }) {
  return <main className="p-6 sm:p-10"><div className="mx-auto max-w-4xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{message}</div></main>;
}
