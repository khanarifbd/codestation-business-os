"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

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
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
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
  const showCustom =
    allowCustom &&
    customValue.length > 0 &&
    !options.some(
      (option) =>
        option.value.toLowerCase() === customValue.toLowerCase() ||
        option.label.toLowerCase() === customValue.toLowerCase(),
    );

  const displayValue = selected?.label ?? (value || placeholder);

  return (
    <div ref={rootRef} className="relative block text-sm font-medium">
      <span>{label}</span>
      <input type="hidden" name={name} value={value} required={required} />
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-2 flex h-11 w-full items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 text-left text-sm outline-none transition hover:border-neutral-300 focus:border-neutral-500"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected || value ? "text-neutral-950" : "text-neutral-400"}>{displayValue}</span>
        <ChevronDown className="size-4 shrink-0 text-neutral-400" />
      </button>

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
            {filtered.map((option) => <button key={`${option.value}-${option.label}`} type="button" onClick={() => choose(option.value)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-neutral-50"><span><span className="block">{option.label}</span>{option.label !== option.value ? <span className="mt-0.5 block text-xs text-neutral-400">{option.value}</span> : null}</span>{value === option.value ? <Check className="size-4 text-neutral-700" /> : null}</button>)}
            {filtered.length === 0 && !showCustom ? <p className="px-3 py-6 text-center text-sm text-neutral-400">No matches found</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
