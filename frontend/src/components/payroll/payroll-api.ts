import { getApiErrorMessage } from "@/lib/api-error";
import { payrollRecord,isPayrollIssue,type PayrollSetupIssue } from "./payroll-model";
export class PayrollRequestError extends Error {
    constructor(message:string,public status:number,public code:string|null=null,public issues:PayrollSetupIssue[]=[],public definiteRejection=false) {super(message);}
}
const meaningful=(value:unknown):value is string=>typeof value==="string"&&Boolean(value.trim())&&!["null","undefined","[object object]","unexpected upstream response"].includes(value.trim().toLowerCase());
export function verifiedPayrollRejection(body:unknown):boolean {
    if(!payrollRecord(body))return false;
    const detail=body.detail;
    if(typeof detail==="string")return meaningful(detail);
    if(Array.isArray(detail))return detail.length>0&&detail.every(x=>payrollRecord(x)&&Array.isArray(x.loc)&&x.loc.length>0&&x.loc.every(p=>meaningful(p)||typeof p==="number"&&Number.isSafeInteger(p)&&p>=0)&&meaningful(x.msg)&&meaningful(x.type));
    return payrollRecord(detail)&&["PAYROLL_PREVIEW_STALE","PAYROLL_PREVIEW_REQUIRED","PAYROLL_SETUP_REQUIRED"].includes(String(detail.code))&&
        (meaningful(detail.message)||Array.isArray(detail.issues)&&detail.issues.length>0&&detail.issues.every(issue=>isPayrollIssue(issue)&&meaningful(issue.code)&&meaningful(issue.message)));
}
export async function payrollRequest(path:string,init?:RequestInit):Promise<unknown> {
    const response=await fetch(path,{cache:"no-store",...init});
    const body:unknown=await response.json().catch(()=>null);
    if(!response.ok) {
        const detail=payrollRecord(body)?body.detail:null;
        const code=payrollRecord(detail)&&typeof detail.code==="string"?detail.code:null;
        const issues=payrollRecord(detail)&&Array.isArray(detail.issues)?detail.issues.filter(isPayrollIssue):[];
        const fallback=code==="PAYROLL_PREVIEW_STALE"?"Payroll inputs changed. Request and review a fresh preview before confirming again.":code==="PAYROLL_PREVIEW_REQUIRED"?"Review a payroll preview before creating this draft.":code==="PAYROLL_SETUP_REQUIRED"?"Payroll setup must be corrected before a draft can be created.":`Payroll request failed (${response.status}).`;
        throw new PayrollRequestError(getApiErrorMessage(body,fallback),response.status,code,issues,[400,401,403,404,409,422].includes(response.status)&&verifiedPayrollRejection(body));
    }
    return body;
}
