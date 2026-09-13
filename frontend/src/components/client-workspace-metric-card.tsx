import type { LucideIcon } from "lucide-react";

type ClientWorkspaceMetricCardProps = {
  label: string;
  value: string | number | null;
  icon: LucideIcon;
  secondary?: string;
  restricted?: boolean;
  variant?: "compact" | "large";
};

export function ClientWorkspaceMetricCard({
  label,
  value,
  icon: Icon,
  secondary,
  restricted = false,
  variant = "compact",
}: ClientWorkspaceMetricCardProps) {
  if (variant === "large") {
    return (
      <article className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-500">{label}</p>
          <Icon className="size-4 text-neutral-300" />
        </div>
        {restricted ? (
          <p className="mt-4 text-sm font-medium text-neutral-400">Restricted</p>
        ) : (
          <>
            <p className="mt-4 text-3xl font-semibold tracking-tight">{value ?? 0}</p>
            {secondary ? <p className="mt-1 text-xs text-neutral-400">{secondary}</p> : null}
          </>
        )}
      </article>
    );
  }

  return (
    <article className="min-w-0 rounded-2xl border bg-white p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-neutral-500 sm:text-sm">{label}</p>
        <Icon className="size-4 shrink-0 text-neutral-400" />
      </div>
      {restricted ? (
        <p className="mt-3 text-xs font-medium text-neutral-400 sm:mt-4 sm:text-sm">Restricted</p>
      ) : (
        <>
          <p className="mt-3 text-xl font-semibold sm:text-2xl">{value ?? 0}</p>
          {secondary ? <p className="mt-1 text-xs text-neutral-400">{secondary}</p> : null}
        </>
      )}
    </article>
  );
}
