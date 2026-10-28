import { getApiErrorMessage } from "@/lib/api-error";
import { payrollRecord,isPayrollIssue,type PayrollSetupIssue } from "./payroll-model";
export class PayrollRequestError extends Error {
    constructor(message:string,public status:number,public code:string|null=null,public issues:PayrollSetupIssue[]=[]) {super(message);}
}
export async function payrollRequest(path:string,init?:RequestInit):Promise<unknown> {
    const response=await fetch(path,{cache:"no-store",...init});
    const body:unknown=await response.json().catch(()=>null);
    if(!response.ok) {
        const detail=payrollRecord(body)?body.detail:null;
        const code=payrollRecord(detail)&&typeof detail.code==="string"?detail.code:null;
        const issues=payrollRecord(detail)&&Array.isArray(detail.issues)?detail.issues.filter(isPayrollIssue):[];
        const fallback=code==="PAYROLL_PREVIEW_STALE"?"Payroll inputs changed. Request and review a fresh preview before confirming again.":code==="PAYROLL_PREVIEW_REQUIRED"?"Review a payroll preview before creating this draft.":code==="PAYROLL_SETUP_REQUIRED"?"Payroll setup must be corrected before a draft can be created.":`Payroll request failed (${response.status}).`;
        throw new PayrollRequestError(getApiErrorMessage(body,fallback),response.status,code,issues);
    }
    return body;
}
