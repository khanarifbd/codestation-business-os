import type { PayrollEntry,PayrollProfile,PayrollRun,PayrollPolicy,PolicyConfiguration,PayrollComponent } from "./payroll-model";
import type { PayrollMode } from "@/lib/payroll-navigation";
export type PayrollDraft={employee_id:string;currency:string;pay_frequency:string;base_salary:string;effective_from:string;effective_to:string;is_active:boolean;name:string;period_start:string;period_end:string;pay_date:string;period_id:string;account_id:string;payment_date:string;amount:string;reference:string;notes:string;tax_amount:string;adjustment_reason:string;allowances:PayrollComponent[];deductions:PayrollComponent[];mode:string;allowance_treatment:string;deduction_treatment:string;weekdays:number[];holiday_treatment:string;weekly_anchor:string;biweekly_anchor:string;activation_reason:string};
export function payrollInitialDraft(today:string):PayrollDraft {return {employee_id:"",currency:"",pay_frequency:"monthly",base_salary:"",effective_from:"",effective_to:"",is_active:true,name:"",period_start:"",period_end:"",pay_date:"",period_id:"",account_id:"",payment_date:today,amount:"",reference:"",notes:"",tax_amount:"0",adjustment_reason:"",allowances:[],deductions:[],mode:"",allowance_treatment:"fixed_latest",deduction_treatment:"fixed_latest",weekdays:[],holiday_treatment:"",weekly_anchor:"",biweekly_anchor:"",activation_reason:""};}
export function payrollProfileDraft(initial:PayrollDraft,profile:PayrollProfile):PayrollDraft {return {...initial,employee_id:profile.employee_id,currency:profile.currency,pay_frequency:profile.pay_frequency,base_salary:profile.base_salary,effective_from:profile.effective_from,effective_to:profile.effective_to??"",is_active:profile.is_active,allowances:profile.default_allowances.map(c=>({...c})),deductions:profile.default_deductions.map(c=>({...c})),notes:profile.notes??""};}
export function payrollEntryDraft(initial:PayrollDraft,entry:PayrollEntry):PayrollDraft {return {...initial,base_salary:entry.base_salary,allowances:entry.allowances.map(c=>({...c})),deductions:entry.deductions.map(c=>({...c})),tax_amount:entry.tax_amount,notes:entry.notes??""};}
export function payrollComponents(items:PayrollComponent[]) {return items.filter(item=>item.name.trim()).map(item=>({name:item.name.trim(),amount:item.amount.trim()||"0"}));}
export const nonnegativePayrollAmount=(value:string)=>/^\d+(?:\.\d{1,2})?$/.test(value.trim());
export const positivePayrollAmount=(value:string)=>nonnegativePayrollAmount(value)&&/[1-9]/.test(value);
export function payrollComponentsValid(items:PayrollComponent[]) {return items.every(item=>!item.name.trim() || item.name.trim().length<=120 && nonnegativePayrollAmount(item.amount.trim()||"0"));}
export function payrollWritePayload(mode:PayrollMode,v:PayrollDraft,context:{run?:PayrollRun;policy?:PayrollPolicy;previewHash?:string;previewVersion?:number}) {
    switch(mode) {
        case "profile_new":return {employee_id:v.employee_id,currency:v.currency,pay_frequency:v.pay_frequency,base_salary:v.base_salary.trim(),effective_from:v.effective_from,default_allowances:payrollComponents(v.allowances),default_deductions:payrollComponents(v.deductions),notes:v.notes.trim()||null};
        case "profile_edit":return {base_salary:v.base_salary.trim(),default_allowances:payrollComponents(v.allowances),default_deductions:payrollComponents(v.deductions),effective_to:v.effective_to||null,is_active:v.is_active,notes:v.notes.trim()||null};
        case "period_new":return {name:v.name.trim(),period_start:v.period_start,period_end:v.period_end,pay_date:v.pay_date};
        case "run_new":return {period_id:v.period_id,currency:v.currency,...(context.previewVersion ? {expected_calculation_hash:context.previewHash}: {})};
        case "entry_edit":return {...(context.run?.policy_version_id ? {base_salary:v.base_salary.trim()}: {}),adjustment_reason:v.adjustment_reason.trim(),allowances:payrollComponents(v.allowances),deductions:payrollComponents(v.deductions),tax_amount:v.tax_amount.trim()||"0",notes:v.notes.trim()};
        case "withholding_new":return {account_id:v.account_id,payment_date:v.payment_date,amount:v.amount.trim(),reference:v.reference.trim()||null,notes:v.notes.trim()||null};
        case "policy_new": {
            const configuration:PolicyConfiguration={mode:v.mode as PolicyConfiguration["mode"],allowance_treatment:v.allowance_treatment as PolicyConfiguration["allowance_treatment"],deduction_treatment:v.deduction_treatment as PolicyConfiguration["deduction_treatment"],...(v.mode==="working_day"?{working_weekdays:[...v.weekdays].sort((a,b)=>a-b),holiday_treatment:v.holiday_treatment as "exclude"|"count_scheduled"}:{}),...(v.weekly_anchor?{weekly_anchor:v.weekly_anchor}:{}),...(v.biweekly_anchor?{biweekly_anchor:v.biweekly_anchor}:{})};
            return {configuration,effective_from:v.effective_from,expected_prior_version:context.policy?.latest_version,activation_reason:v.activation_reason.trim()};
        }
        case "pay":return {account_id:v.account_id};
        case "approve":return undefined;
        default:throw new Error("This payroll document is read-only.");
    }
}
