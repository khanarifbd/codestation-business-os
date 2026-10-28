"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { safeAdvancedReturn, safeCorrectionReturn, safeJournalReturn } from "@/lib/advanced-accounting-navigation";
import { AdvancedState } from "./advanced-ui";
import { AdvancedRegister } from "./advanced-register";
import { AdvancedDocument } from "./advanced-document";
import { AdvancedLedgerEditor, AdvancedAdjustmentEditor, AdvancedCorrectionEditor } from "./advanced-editors";
import { AdvancedCorrections } from "./advanced-corrections";
import "@/components/accounting-accounts/account-workspace.css";
import "./advanced.css";

export function AdvancedWorkspace() {
  const { tenant, loading } = useDashboardSession(), pathname = usePathname();
  if (loading) return <RelationshipPage className="aa-workspace ad-workspace"><AdvancedState loading title="Loading accounting workspace…"/></RelationshipPage>;
  return <RelationshipPage className="aa-workspace ad-workspace"><AdvancedContent key={`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`}/></RelationshipPage>;
}
function AdvancedContent() {
  const pathname = usePathname(), query = useSearchParams();
  const params = useParams<{ journalId?: string; sourceType?: string; sourceId?: string }>();
  const returnHref = safeAdvancedReturn(query.get("returnTo"));
  if (params.journalId) return <AdvancedDocument journalId={params.journalId} reversing={pathname.endsWith("/reverse")} returnHref={safeJournalReturn(query.get("returnTo"))}/>;
  if (pathname.endsWith("/ledgers/new")) return <AdvancedLedgerEditor returnHref={returnHref}/>;
  if (pathname.endsWith("/adjustment")) return <AdvancedAdjustmentEditor returnHref={returnHref}/>;
  if (params.sourceType && params.sourceId) return <AdvancedCorrectionEditor sourceType={params.sourceType} sourceId={params.sourceId} returnHref={safeCorrectionReturn(query.get("returnTo"))}/>;
  if (pathname.endsWith("/corrections")) return <AdvancedCorrections/>;
  return <AdvancedRegister/>;
}
