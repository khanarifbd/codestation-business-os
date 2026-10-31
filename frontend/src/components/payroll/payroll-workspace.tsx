"use client";
import {usePathname} from "next/navigation";
import {ArrowLeft,ArrowRight,Plus} from "lucide-react";
import {useDashboardSession} from "@/components/dashboard-session-context";
import {RelationshipPage,RelationshipNotice} from "@/components/relationships/relationship-ui";
import {usePayrollWorkspace} from "@/hooks/use-payroll-workspace";
import {PayrollState} from "./payroll-ui";
import {PayrollRegister,PayrollPolicyDocument} from "./payroll-register";
import {PayrollRunDocument,PayrollEntryDocument,PayrollProfileDocument,PayrollPeriodDocument,PayrollWithholdingDocument} from "./payroll-documents";
import {PayrollEditor,PayrollSetupIssues,PayrollPolicyRecovery} from "./payroll-editors";
import "./payroll.css";
export function PayrollWorkspace() {const {tenant,loading}=useDashboardSession(),pathname=usePathname();const key=`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${tenant?.status}:${pathname}`;if(loading)return <RelationshipPage className="pr-workspace"><PayrollState loading title="Loading payroll workspace…"/></RelationshipPage>;return <PayrollContent key={key}/>;}
export function PayrollContent() {
    const vm=usePayrollWorkspace();
    const manualPeriod=vm.route.mode==="period_new"&&vm.canManage;
    if(!vm.canView&&!manualPeriod)return <RelationshipPage className="pr-workspace"><PayrollState title="Payroll viewing is restricted" action={vm.canManage?<a className="pr-primary" href={vm.nativeHref("periods/new")}><Plus aria-hidden="true"/>Create a pay period</a>:undefined}>Your role does not include payroll viewing permission.{vm.canManage?" You can create a manual period without reading employee payroll data.":""}</PayrollState></RelationshipPage>;
    if(vm.editing&&!vm.canManage)return <RelationshipPage className="pr-workspace"><PayrollState title="Payroll management is restricted">This document requires payroll management permission. No write has been attempted.</PayrollState></RelationshipPage>;
    const missingRecord=vm.route.mode==="profile_edit"&&!vm.profile||vm.route.mode==="entry_edit"&&(!vm.run||!vm.entry);
    return <RelationshipPage className="pr-workspace">
        {vm.route.mode!=="register"?<div className="pr-breadcrumb"><button className="pr-back" onClick={vm.back} disabled={vm.saving}><ArrowLeft aria-hidden="true"/>Back to payroll</button><span>{vm.editing?"Dedicated payroll document":"Read-only workspace"}</span></div>:null}
        {vm.error?<RelationshipNotice tone="error">{vm.error}</RelationshipNotice>:null}
        {vm.policyRecovery?<PayrollPolicyRecovery vm={vm}/>:null}
        {vm.issues.length?<PayrollSetupIssues vm={vm} issues={vm.issues}/>:null}
        {vm.uncertain?<RelationshipNotice tone="error"><strong>The write outcome is uncertain.</strong> Your inputs are retained, but submission is locked in this document to avoid a duplicate. Verify the current record or history before starting another attempt. <a href={vm.verificationHref} target="_blank" rel="noopener">Open read-only verification</a></RelationshipNotice>:null}
        {vm.committed?<PayrollState title="Payroll action recorded" action={<button className="pr-primary" onClick={vm.openSaved}>{vm.canView?"Open saved result":"Return to dashboard"}<ArrowRight aria-hidden="true"/></button>}>The server confirmed this action. Do not submit it again. {vm.canView?"Open the saved document or register to verify the result.":"Your role can create a period but does not include payroll viewing access."}</PayrollState>
        :vm.route.mode==="unavailable"?<PayrollState title="Payroll route unavailable">Use a supported payroll document from the register.</PayrollState>
        :vm.editing?(Object.keys(vm.errors).length?<PayrollState title="Payroll setup unavailable" action={<button className="pr-secondary" onClick={()=>void vm.load()}>Retry loading</button>}>{Object.values(vm.errors).join(" ")} Your draft inputs remain preserved.</PayrollState>:vm.anyLoading?<PayrollState loading title="Loading document context…"/>:missingRecord?<PayrollState title="Payroll record unavailable">The requested record is not present in the verified response.</PayrollState>:<PayrollEditor vm={vm}/>)
        :vm.route.mode==="register"?<PayrollRegister vm={vm}/>
        :vm.route.mode==="run"?<PayrollRunDocument vm={vm}/>
        :vm.route.mode==="entry"?<PayrollEntryDocument vm={vm}/>
        :vm.route.mode==="profile"?<PayrollProfileDocument vm={vm}/>
        :vm.route.mode==="period"?<PayrollPeriodDocument vm={vm}/>
        :vm.route.mode==="withholding"?<PayrollWithholdingDocument vm={vm}/>
        :<PayrollPolicyDocument vm={vm}/>}
    </RelationshipPage>;
}
