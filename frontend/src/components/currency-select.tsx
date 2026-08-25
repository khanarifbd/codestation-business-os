"use client";

import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

export function CurrencySelect({
  label = "Currency",
  value,
  onValueChange,
  required = false,
  clearable = true,
  placeholder = "Select currency",
  disabled = false,
}: {
  label?: string;
  value: string | null;
  onValueChange: (value: string) => void;
  required?: boolean;
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <SearchableSelect
      label={label}
      value={value}
      onValueChange={onValueChange}
      options={CURRENCY_OPTIONS}
      required={required}
      clearable={clearable}
      placeholder={placeholder}
      searchPlaceholder="Search currency or code..."
      disabled={disabled}
    />
  );
}
