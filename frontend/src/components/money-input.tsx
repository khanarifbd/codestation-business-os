"use client";

export function MoneyInput({
  label,
  currency,
  value,
  onValueChange,
  required = false,
  min = 0,
  max,
  step = 0.01,
  placeholder = "0.00",
  hint,
  readOnly = false,
}: {
  label?: string;
  currency?: string | null;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  hint?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-neutral-600">
      {label ? <span className="mb-1.5 block">{label}</span> : null}
      <div className={`flex h-11 overflow-hidden rounded-xl border bg-white ${readOnly ? "bg-neutral-50" : ""}`}>
        <span className="flex min-w-16 items-center justify-center border-r px-3 text-sm font-medium text-neutral-400">
          {currency || "—"}
        </span>
        <input
          required={required}
          readOnly={readOnly}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-3 text-sm font-normal outline-none placeholder:text-neutral-300"
        />
      </div>
      {hint ? <span className="mt-1 block text-xs font-normal text-neutral-400">{hint}</span> : null}
    </label>
  );
}
