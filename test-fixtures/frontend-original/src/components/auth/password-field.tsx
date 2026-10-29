"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

export function PasswordField({
  name,
  label,
  autoComplete,
  placeholder,
  minLength = 8,
  hideLabel = false,
}: {
  name: string;
  label: string;
  autoComplete: string;
  placeholder: string;
  minLength?: number;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);

  return (
    <div className="block text-sm font-medium text-neutral-800">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>{label}</label>
      <div className="relative mt-2">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 pr-12 text-[15px] outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-neutral-500 focus:ring-4 focus:ring-neutral-950/[0.04]"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          className="absolute inset-y-0 right-1 flex w-10 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-50 hover:text-neutral-700"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}
