"use client";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { FinancialReport } from "./financial-report";
import { AccountStatement } from "./account-statement";
import { StatementState } from "./statement-ui";
import "@/components/accounting-accounts/account-workspace.css";
import "./statements.css";
export function StatementWorkspace({ account = false }: { account?: boolean }) {
  const { tenant, loading } = useDashboardSession();
  const scope = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions]);
  return <RelationshipPage className="aa-workspace">{loading ? <StatementState title="Loading reporting workspace" loading/> : account ? <AccountStatement key={scope}/> : <FinancialReport key={scope}/>}</RelationshipPage>;
}
