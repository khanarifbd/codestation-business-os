"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { useSelfServiceWorkspace } from "@/hooks/use-self-service-workspace";
import { EmployeeHome } from "./employee-home";
import { SelfServiceRegister, SelfReviewDocument } from "./self-service-register";
import { SelfServiceEditor } from "./self-service-editors";
import { SelfState } from "./self-service-ui";
import "./self-service.css";

export function SelfServiceWorkspace() {
  const { tenant, loading } = useDashboardSession(), pathname = usePathname(), params = useSearchParams();
  const kind = params.get("kind") === "correction" ? "correction" : "remote";
  const identity = `${tenant?.organization.id || "no-company"}:${tenant?.membership_id || "no-membership"}:${tenant?.role_id || "no-role"}:${tenant?.permissions.join("|") || ""}:${pathname}:${kind}`;
  if (loading) return <RelationshipPage className="self-service-workspace"><SelfState loading title="Loading employee workspace…" text="Retrieving your current workspace access." /></RelationshipPage>;
  return <SelfServiceContent key={identity} />;
}
export function EmployeeHomeWorkspace() { return <SelfServiceWorkspace />; }
function SelfServiceContent() {
  const vm = useSelfServiceWorkspace();
  if (vm.loading && !Object.values(vm.resources).some(Boolean)) return <RelationshipPage className="self-service-workspace"><SelfState loading title="Loading your workspace…" text="Retrieving the sections available to your current role." /></RelationshipPage>;
  return <RelationshipPage className="self-service-workspace">
    {vm.mode !== "home" && vm.mode !== "register" ? <div className="ss-breadcrumb"><button className="ss-back" onClick={vm.back} disabled={vm.busy}><ArrowLeft aria-hidden="true" />{vm.mode === "review_edit" ? "Back to review" : "Back to workspace"}</button><span>Employee self-service</span></div> : null}
    {vm.message ? <RelationshipNotice tone="success">{vm.message}</RelationshipNotice> : null}
    {vm.error ? <RelationshipNotice tone="error">{vm.error}</RelationshipNotice> : null}
    {vm.busy ? <RelationshipNotice>Keep this page open until the action finishes. If the response is interrupted, check its saved history before retrying.</RelationshipNotice> : null}
    {vm.committed ? <SelfState title="Your change was saved" text="Open the saved result to verify its latest status. Do not submit this request or review again." action={<button className="ss-primary" disabled={vm.busy} onClick={vm.openSaved}>Open saved result<ArrowRight aria-hidden="true" /></button>} /> : vm.mode === "home" ? <EmployeeHome vm={vm} /> : vm.mode === "register" ? <SelfServiceRegister vm={vm} /> : vm.mode === "review" ? <SelfReviewDocument vm={vm} /> : <SelfServiceEditor vm={vm} />}
  </RelationshipPage>;
}
