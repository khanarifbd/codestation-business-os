import type { ReactNode } from "react";
import { AppPage } from "@/components/ui/app-page";
import "./relationship-workspace.css";

/** Presentation only: data loading, permissions and actions stay with each workspace. */
export function RelationshipPage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <AppPage width="wide" className={`relationship-workspace ${className}`}>{children}</AppPage>;
}

export function RelationshipHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="relationship-header"><div><p className="relationship-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="relationship-description">{description}</p></div>{actions ? <div className="relationship-header-actions">{actions}</div> : null}</header>;
}

export function RelationshipMetric({ label, value, note, attention = false }: { label: string; value: ReactNode; note?: string; attention?: boolean }) {
  return <div className="relationship-metric" data-attention={attention || undefined}><dt>{label}{note ? <span>{note}</span> : null}</dt><dd>{value}</dd></div>;
}

export function RelationshipNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "error" }) {
  return <div className="relationship-notice" data-tone={tone} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
