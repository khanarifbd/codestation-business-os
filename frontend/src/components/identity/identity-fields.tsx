"use client";
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
export function IdentityPassword({ label, name, value, onChange, existing, disabled }: { label: string; name: string; value: string; onChange: (value: string) => void; existing: boolean; disabled: boolean }) {
  const id = useId(), [visible, setVisible] = useState(false);
  return <div className="identity-field"><label htmlFor={id}>{label}</label><div className="identity-password"><input id={id} name={name} type={visible ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} minLength={8} maxLength={128} required disabled={disabled} autoComplete={existing ? "current-password" : "new-password"} /><button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div></div>;
}
