"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { safeLoanReturn } from "@/lib/loan-navigation";
import { LoanRegister } from "./loan-register";
import { LoanDocument } from "./loan-document";
import { LoanAgreementEditor, LoanReceiveEditor, LoanRepayEditor, LoanLifecycleEditor } from "./loan-editors";
import { LoanState } from "./loan-ui";
import "@/components/accounting-accounts/account-workspace.css";
import "./loan.css";

export function LoanWorkspace() {
  const { tenant,loading } = useDashboardSession(), pathname = usePathname();
  if (loading) return <RelationshipPage className="aa-workspace ln-workspace"><LoanState loading title="Loading loan workspace…"/></RelationshipPage>;
  return <RelationshipPage className="aa-workspace ln-workspace"><LoanContent key={`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`}/></RelationshipPage>;
}
function LoanContent() {
  const pathname = usePathname(), query = useSearchParams(), params = useParams<{loanId?:string}>(), returnHref = safeLoanReturn(query.get("returnTo"));
  if (pathname.endsWith("/new")) return <LoanAgreementEditor returnHref={returnHref}/>;
  if (params.loanId) {
    if (pathname.endsWith("/receive")) return <LoanReceiveEditor loanId={params.loanId} returnHref={returnHref}/>;
    if (pathname.endsWith("/repay")) return <LoanRepayEditor loanId={params.loanId} returnHref={returnHref}/>;
    if (pathname.endsWith("/approve") || pathname.endsWith("/close")) return <LoanLifecycleEditor loanId={params.loanId} kind={pathname.endsWith("/approve") ? "approve" : "close"} returnHref={returnHref}/>;
    return <LoanDocument loanId={params.loanId} returnHref={returnHref}/>;
  }
  return <LoanRegister/>;
}
