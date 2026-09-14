import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function AppPage({ children, className, width = "wide" }: { children: ReactNode; className?: string; width?: "normal" | "wide" | "full" }) {
  return (
    <main className={cn("min-h-screen bg-[var(--app-canvas)] px-4 py-5 text-neutral-950 sm:px-6 sm:py-7 lg:px-8 lg:py-9", className)}>
      <div
        className={cn(
          "mx-auto w-full",
          width === "normal" && "max-w-7xl",
          width === "wide" && "max-w-[1500px]",
          width === "full" && "max-w-none",
        )}
      >
        {children}
      </div>
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{eyebrow}</div> : null}
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-neutral-950 sm:text-[30px] sm:leading-9">{title}</h1>
        {description ? <div className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">{description}</div> : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-[15px] font-semibold text-neutral-950">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-neutral-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]", className)}>{children}</section>;
}
