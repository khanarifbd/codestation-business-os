import type { ReactNode } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { selfLabel } from "./self-service-model";

export function SelfStatus({ value }: { value: string }) { return <span className="ss-status" data-status={value}>{selfLabel(value)}</span>; }
export function SelfState({ title, text, action, loading = false }: { title: string; text: string; action?: ReactNode; loading?: boolean }) { return <section className={`ss-state${loading ? " ss-loading" : ""}`} role={loading ? "status" : undefined}>{loading ? <Loader2 aria-hidden="true" /> : null}<div><h2>{title}</h2><p>{text}</p>{action ? <div className="ss-state-action">{action}</div> : null}</div></section>; }
export function SelfSectionHeading({ title, text, action }: { title: string; text?: string; action?: ReactNode }) { return <div className="ss-section-heading"><div><h2>{title}</h2>{text ? <p>{text}</p> : null}</div>{action}</div>; }
export function SelfFact({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
export function SelfLinkArrow() { return <ArrowRight aria-hidden="true" />; }
