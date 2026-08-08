"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type SearchOption = {
  value: string;
  label: string;
  keywords?: string;
};

export function SearchableSelect({
  label,
  name,
  defaultValue,
  value: controlledValue,
  onValueChange,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  required = false,
  allowCustom = false,
  clearable = true,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  value?: string | null;
  onValueChange?: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  required?: boolean;
  allowCustom?: boolean;
  clearable?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue ?? "" : internalValue;

  useEffect(() => {
    if (!isControlled) setInternalValue(defaultValue ?? "");
  }, [defaultValue, isControlled]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.keywords ?? ""}`.toLowerCase().includes(needle),
    );
  }, [options, query]);

  function choose(nextValue: string) {
    if (!isControlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    setQuery("");
    setOpen(false);
  }

  const customValue = query.trim();
  const showCustom = allowCustom && customValue.length > 0 && !options.some(
    (option) => option.value.toLowerCase() === customValue.toLowerCase() || option.label.toLowerCase() === customValue.toLowerCase(),
  );
  const displayValue = selected?.label ?? (value || placeholder);
  const canClear = clearable && !required && Boolean(value);

  return (
    <div ref={rootRef} className="relative block text-sm font-medium">
      <span>{label}</span>
      <input type="hidden" name={name} value={value} required={required} />
      <div className="relative mt-2">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex h-11 w-full items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 pr-16 text-left text-sm outline-none transition hover:border-neutral-300 focus:border-neutral-500"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={`truncate ${selected || value ? "text-neutral-950" : "text-neutral-400"}`}>{displayValue}</span>
        </button>
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
          {canClear ? <button type="button" aria-label={`Clear ${label}`} onClick={(event) => { event.stopPropagation(); choose(""); }} className="pointer-events-auto rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X className="size-3.5" /></button> : null}
          <ChevronDown className={`size-4 shrink-0 text-neutral-400 transition ${open ? "rotate-180" : ""}`} />
        </div>
      </div>

      {open ? (
        <div className="absolute z-50 mt-2 w-full min-w-[260px] overflow-hidden rounded-xl border bg-white shadow-xl shadow-neutral-200/60">
          <div className="border-b p-2">
            <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3">
              <Search className="size-4 text-neutral-400" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-neutral-400" />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5" role="listbox">
            {showCustom ? <button type="button" onClick={() => choose(customValue)} className="flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm hover:bg-neutral-50">Use “{customValue}”</button> : null}
            {filtered.map((option) => <button key={`${option.value}-${option.label}`} type="button" onClick={() => choose(option.value)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-neutral-50"><span className="min-w-0"><span className="block truncate">{option.label}</span>{option.label !== option.value ? <span className="mt-0.5 block truncate text-xs text-neutral-400">{option.value}</span> : null}</span>{value === option.value ? <Check className="size-4 shrink-0 text-neutral-700" /> : null}</button>)}
            {filtered.length === 0 && !showCustom ? <p className="px-3 py-6 text-center text-sm text-neutral-400">No matches found</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
