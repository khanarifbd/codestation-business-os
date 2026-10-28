"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { safeReconciliationReturn } from "@/lib/reconciliation-navigation";
import { ReconciliationState } from "./reconciliation-ui";
import { ReconciliationRegister } from "./reconciliation-register";
import { ReconciliationCreate } from "./reconciliation-create";
import { ReconciliationDocument } from "./reconciliation-document";
import "@/components/accounting-accounts/account-workspace.css";
import "./reconciliation.css";

export function ReconciliationWorkspace() {
  const { tenant, loading } = useDashboardSession(), pathname = usePathname();
  if (loading) return <RelationshipPage className="aa-workspace rc-workspace">
    <ReconciliationState loading title="Loading reconciliation workspace…"/>
  </RelationshipPage>;
  return <RelationshipPage className="aa-workspace rc-workspace">
    <ReconciliationContent key={`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`}/>
  </RelationshipPage>;
}

function ReconciliationContent() {
  const pathname = usePathname(), params = useParams<{ reconciliationId?: string }>(), query = useSearchParams();
  const returnHref = safeReconciliationReturn(query.get("returnTo"));
  if (pathname.endsWith("/new")) return <ReconciliationCreate returnHref={returnHref}/>;
  if (params.reconciliationId) return <ReconciliationDocument reconciliationId={params.reconciliationId}
    matching={pathname.endsWith("/match")} returnHref={returnHref}/>;
  return <ReconciliationRegister/>;
}
