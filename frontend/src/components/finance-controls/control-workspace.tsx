"use client";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { controlListHref, safeControlReturn } from "@/lib/finance-controls-navigation";
import type { ControlTab } from "./control-types";
import { ControlRegister } from "./control-register";
import { ControlDocument } from "./control-document";
import { ControlCreate } from "./control-create";
import { ControlAction } from "./control-action";
import { ControlManualPost } from "./control-manual-post";
import { ControlState } from "./control-ui";
import "@/components/accounting-accounts/account-workspace.css";
import "@/components/accounting-advanced/advanced.css";
import "./controls.css";
export function ControlWorkspace() {
  const { tenant, loading } = useDashboardSession(), pathname = usePathname();
  const scope = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions]);
  if (loading)
    return <RelationshipPage className="aa-workspace">

      <ControlState title="Loading controls" loading />

    </RelationshipPage>;
  return <RelationshipPage className="aa-workspace">

    <ControlContent key={`${scope}:${pathname}`} scope={scope} />

  </RelationshipPage>;
}
function ControlContent({ scope }: {
  scope: string;
}) {
  const path = usePathname(), q = useSearchParams(), params = useParams<{
    recurringId?: string;
    periodId?: string;
  }>();
  const tab: ControlTab = path.includes("/automation/") ? "automation" : path.includes("/periods/") ? "periods" : "recurring",
    id = params.recurringId || params.periodId || "",
    back = safeControlReturn(q.get("returnTo"), tab),
    mode = path.split("/").at(-1) || "";
  if (path.endsWith("/recurring/new") || path.endsWith("/periods/new"))
    return <ControlCreate kind={tab === "periods" ? "periods" : "recurring"} returnTo={back} />;
  if (id) {
    if (tab === "recurring" && mode === "post")
      return <ControlManualPost id={id} returnTo={back} scope={scope} />;
    if (["status", "configure", "retry", "close", "reopen"].includes(mode))
      return <ControlAction tab={tab} id={id} mode={mode} returnTo={back} />;
    return <ControlDocument tab={tab} id={id} returnTo={back} />;
  }
  if (path === "/dashboard/finance/auto-post")
    return <ControlRegister defaultTab="automation" />;
  if (path.endsWith("/controls"))
    return <ControlRegister />;
  return <ControlState
    title="Control route unavailable"
    action={<a href={controlListHref()} className="aa-secondary">Open control register</a>} />;
}
