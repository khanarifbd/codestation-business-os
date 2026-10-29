import { PAYROLL_TABS,type PayrollTab } from "@/components/payroll/payroll-model";
export const PAYROLL_PATH="/dashboard/payroll";
export type PayrollMode="register"|"run"|"entry"|"profile"|"period"|"withholding"|"policy"|"run_new"|"entry_edit"|"profile_new"|"profile_edit"|"period_new"|"withholding_new"|"policy_new"|"approve"|"pay"|"unavailable";
export type PayrollRoute={mode:PayrollMode;id:string;entryId:string};
export function payrollRoute(pathname:string):PayrollRoute {
    const unavailable:PayrollRoute={mode:"unavailable",id:"",entryId:""};
    if(pathname!==PAYROLL_PATH&&!pathname.startsWith(PAYROLL_PATH+"/"))return unavailable;
    let parts:string[];try {parts=pathname.slice(PAYROLL_PATH.length).split("/").slice(1).map(decodeURIComponent);if(pathname===PAYROLL_PATH)parts=[];if(parts.some(part=>!part||/[/?#\\]/.test(part)||part==="."||part===".."))return unavailable;}catch{return unavailable;}
    const [section,id,action,entryId,edit]=parts;
    const result=(mode:PayrollMode)=>({mode,id:id??"",entryId:entryId??""});
    if(!parts.length)return result("register");
    if(section==="policy")return result(parts.length===1?"policy":id==="new"&&parts.length===2?"policy_new":"unavailable");
    if(!["runs","profiles","periods","withholdings"].includes(section)||!id)return result("unavailable");
    if(id==="new"&&parts.length===2)return result(({runs:"run_new",profiles:"profile_new",periods:"period_new",withholdings:"withholding_new"} as const)[section as "runs"]);
    if(id==="new")return result("unavailable");
    if(parts.length===2)return result(({runs:"run",profiles:"profile",periods:"period",withholdings:"withholding"} as const)[section as "runs"]);
    if(section==="runs"&&parts.length===3&&(action==="approve"||action==="pay"))return result(action);
    if(section==="runs"&&action==="entries"&&entryId&&entryId!=="new")return result(parts.length===4?"entry":parts.length===5&&edit==="edit"?"entry_edit":"unavailable");
    if(section==="profiles"&&parts.length===3&&action==="edit")return result("profile_edit");
    return result("unavailable");
}
export const isPayrollEditor=(mode:PayrollMode)=>["run_new","entry_edit","profile_new","profile_edit","period_new","withholding_new","policy_new","approve","pay"].includes(mode);
export function payrollBrowse(raw:string|URLSearchParams) {const p=new URLSearchParams(raw),tab=p.get("tab");return {tab:PAYROLL_TABS.includes(tab as PayrollTab)?tab as PayrollTab:"runs" as PayrollTab,focus:(p.get("focus")??"").slice(0,200)};}
export function payrollBrowseHref(tab:PayrollTab="runs",focus="") {const p=new URLSearchParams();if(tab!=="runs")p.set("tab",tab);if(focus)p.set("focus",focus.slice(0,200));return `${PAYROLL_PATH}${p.size?`?${p}`:""}`;}
export function safePayrollReturn(raw:string|null|undefined,fallback=PAYROLL_PATH):string {
    if(!raw || !raw.startsWith(PAYROLL_PATH) || raw.includes("#"))return fallback;
    try {const u=new URL(raw,"https://local.invalid");if(u.origin!=="https://local.invalid")return fallback;const route=payrollRoute(u.pathname);if(route.mode==="register")return payrollBrowseHref(payrollBrowse(u.searchParams).tab,payrollBrowse(u.searchParams).focus);if(isPayrollEditor(route.mode)||route.mode==="unavailable")return fallback;const p=new URLSearchParams();const list=u.searchParams.get("returnTo");if(list && list.split("?")[0]===PAYROLL_PATH)p.set("returnTo",payrollBrowseHref(payrollBrowse(list.split("?")[1]??"").tab,payrollBrowse(list.split("?")[1]??"").focus));return u.pathname+(p.size?`?${p}`:"");}catch{return fallback;}
}
export function payrollHref(suffix:string,returnTo=PAYROLL_PATH) {return `${PAYROLL_PATH}/${suffix}?${new URLSearchParams({returnTo:safePayrollReturn(returnTo)})}`;}
