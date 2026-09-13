import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type ClientWorkspaceSectionProps = {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  eyebrow?: string;
  icon?: LucideIcon;
  className?: string;
  contentClassName?: string;
  variant?: "compact" | "portal";
};

export function ClientWorkspaceSection({
  title,
  children,
  action,
  eyebrow,
  icon: Icon,
  className = "",
  contentClassName = "",
  variant = "compact",
}: ClientWorkspaceSectionProps) {
  if (variant === "portal") {
    return (
      <section className={`${className} rounded-2xl border bg-white p-5 shadow-sm sm:p-6`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            {eyebrow ? <p className="text-sm text-neutral-500">{eyebrow}</p> : null}
            <h2 className={eyebrow ? "mt-1 text-xl font-semibold" : "text-xl font-semibold"}>{title}</h2>
          </div>
          {Icon ? <Icon className="size-5 shrink-0 text-neutral-300" /> : null}
        </div>
        <div className={`mt-5 ${contentClassName}`}>{children}</div>
      </section>
    );
  }

  return (
    <section className={`${className} rounded-2xl border bg-white p-4 shadow-sm sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={`mt-4 sm:mt-5 ${contentClassName}`}>{children}</div>
    </section>
  );
}
