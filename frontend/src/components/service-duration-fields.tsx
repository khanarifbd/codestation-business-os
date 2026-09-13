"use client";

export function ServiceDurationFields({
  durationMonths,
  onChange,
}: {
  durationMonths: string;
  onChange: (value: string) => void;
}) {
  const fixed = durationMonths !== "";
  return <>
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">Service duration</span>
      <select
        value={fixed ? "fixed" : "one_time"}
        onChange={(event) => onChange(event.target.value === "fixed" ? "1" : "")}
        className="h-11 rounded-xl border bg-white px-3"
      >
        <option value="one_time">One-time</option>
        <option value="fixed">Fixed duration</option>
      </select>
      <span className="text-xs leading-5 text-neutral-400">One-time services do not expire. Fixed services are tracked from a start date for the selected number of months.</span>
    </label>
    {fixed ? <label className="grid gap-1.5 text-sm">
      <span className="font-medium">Duration (months)</span>
      <input
        required
        type="number"
        min="1"
        max="120"
        step="1"
        value={durationMonths}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl border px-3 outline-none focus:border-neutral-700"
      />
      <span className="text-xs leading-5 text-neutral-400">Examples: 1, 3 or 6 months. The sold duration is snapshotted on quotations, orders and invoices.</span>
    </label> : null}
  </>;
}
