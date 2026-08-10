"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type CursorPagerProps = {
  page: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
  loading?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (value: number) => void;
  shownCount: number;
};

export function CursorPager({ page, pageSize, hasPrevious, hasNext, loading = false, onPrevious, onNext, onPageSizeChange, shownCount }: CursorPagerProps) {
  return <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-xs text-neutral-400">Page {page} · {shownCount} record{shownCount === 1 ? "" : "s"} shown</p>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-neutral-500">Rows
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} disabled={loading} className="rounded-lg border bg-white px-2 py-1.5 text-xs text-neutral-700">
          {[20, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <button type="button" onClick={onPrevious} disabled={!hasPrevious || loading} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"><ChevronLeft className="size-3.5" />Previous</button>
      <button type="button" onClick={onNext} disabled={!hasNext || loading} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40">Next<ChevronRight className="size-3.5" /></button>
    </div>
  </div>;
}
