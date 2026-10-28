"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { safeTaxReturn, TAX_CODES_PATH, TAX_SETTLEMENTS_PATH } from "@/lib/tax-navigation";
import { TaxReportView } from "./tax-report";
import { TaxCodeRegister, TaxSettlementRegister } from "./tax-registers";
import { TaxDocument } from "./tax-documents";
import { TaxCodeEditor, TaxSettlementEditor } from "./tax-editors";
import { TaxState } from "./tax-ui";
import "@/components/accounting-accounts/account-workspace.css";
import "./tax.css";

export function TaxWorkspace() {
  const {tenant,loading}=useDashboardSession(),pathname=usePathname();
  if(loading)return <RelationshipPage className="aa-workspace tx-workspace"><TaxState loading title="Loading tax workspace…"/></RelationshipPage>;
  return <RelationshipPage className="aa-workspace tx-workspace"><TaxContent key={`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`}/></RelationshipPage>;
}
function TaxContent(){const pathname=usePathname(),query=useSearchParams(),params=useParams<{taxCodeId?:string;settlementId?:string}>(),codeReturn=safeTaxReturn(query.get("returnTo"),TAX_CODES_PATH),settlementReturn=safeTaxReturn(query.get("returnTo"),TAX_SETTLEMENTS_PATH);if(pathname===TAX_CODES_PATH+"/new")return <TaxCodeEditor id={null} returnHref={codeReturn}/>;if(params.taxCodeId)return pathname.endsWith("/edit") ? <TaxCodeEditor id={params.taxCodeId} returnHref={codeReturn}/> : <TaxDocument kind="code" id={params.taxCodeId} returnHref={codeReturn}/>;if(pathname===TAX_CODES_PATH)return <TaxCodeRegister/>;if(pathname===TAX_SETTLEMENTS_PATH+"/new")return <TaxSettlementEditor returnHref={settlementReturn}/>;if(params.settlementId)return <TaxDocument kind="settlement" id={params.settlementId} returnHref={settlementReturn}/>;if(pathname===TAX_SETTLEMENTS_PATH)return <TaxSettlementRegister/>;return <TaxReportView/>;}
