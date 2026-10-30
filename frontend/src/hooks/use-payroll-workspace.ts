"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import {useDashboardSession} from "@/components/dashboard-session-context";
import {useDocumentNavigationGuard} from "@/hooks/use-document-navigation-guard";
import {usePayrollRead,payrollReadSpec} from "@/hooks/use-payroll-read";
import {payrollRequest,PayrollRequestError} from "@/components/payroll/payroll-api";
import {companyPayrollToday,isPayrollPreview,payrollMoney,payrollRecord,type PayrollPreview,type PayrollPolicy,type PayrollSetupIssue,type PayrollTab} from "@/components/payroll/payroll-model";
import {payrollInitialDraft,payrollEntryDraft,payrollProfileDraft,payrollWritePayload,payrollComponentsValid,positivePayrollAmount,nonnegativePayrollAmount,type PayrollDraft} from "@/components/payroll/payroll-drafts";
import {payrollRoute,payrollBrowse,payrollBrowseHref,payrollHref,safePayrollReturn,isPayrollEditor} from "@/lib/payroll-navigation";
const UNKNOWN_EXIT="This payroll action may already have been recorded. Leaving loses the current-document lock. Verify the original action before any replacement. Leave?";
const dateValue=(v:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const [y,m,d]=v.split("-").map(Number);if(y<1||m<1||m>12||d<1)return false;const leap=y%4===0&&(y%100!==0||y%400===0);return d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];};
export function usePayrollWorkspace() {
    const {tenant,loading:sessionLoading}=useDashboardSession(),router=useRouter(),pathname=usePathname(),params=useSearchParams();
    // PayrollContent is keyed by this document identity. A reused retired hook
    // cannot revive its old draft; the new keyed component owns a fresh lifetime.
    const scope=JSON.stringify([tenant?.organization.id,tenant?.membership_id,tenant?.role_id,tenant?.permissions,tenant?.status,pathname,sessionLoading]);
    const [documentScope]=useState(scope);
    const owner=useMemo(()=>({scope}),[scope]),activeOwner=useRef<object|null>(null);
    const ownsDocument=useCallback(()=>activeOwner.current===owner&&documentScope===scope,[owner,documentScope,scope]);
    useLayoutEffect(()=>{activeOwner.current=owner;return()=>{if(activeOwner.current===owner)activeOwner.current=null;};},[owner]);
    const route=payrollRoute(pathname),browse=payrollBrowse(params.toString()),editing=isPayrollEditor(route.mode);
    const canView=!sessionLoading&&Boolean(tenant?.permissions.some(p=>p==="*"||p==="payroll.view")),canManage=!sessionLoading&&Boolean(tenant?.permissions.some(p=>p==="*"||p==="payroll.manage"));
    const timezone=tenant?.organization.timezone??"",today=companyPayrollToday(timezone);
    const [values,setValues]=useState(()=>payrollInitialDraft(today)),[initial,setInitial]=useState(()=>payrollInitialDraft(today));
    const draftRef=useRef(values),mounted=useRef(true),initialized=useRef(false),inFlight=useRef(false),committedRef=useRef(false),uncertainRef=useRef(false),previewEpoch=useRef(0);
    const [formInitialized,setFormInitialized]=useState(false);
    const [policyRecovery,setPolicyRecovery]=useState<"reload"|"review"|null>(null),[policyRecoveryContext,setPolicyRecoveryContext]=useState<PayrollPolicy|null>(null);
    const policyRecoveryRef=useRef(false),policyReloadingRef=useRef(false),refreshedPolicyKey=useRef("");
    const [saving,setSaving]=useState(false),[committed,setCommitted]=useState(false),[savedId,setSavedId]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[issues,setIssues]=useState<PayrollSetupIssue[]>([]),[uncertain,setUncertain]=useState(false);
    const [previewState,setPreviewState]=useState<{key:string;data:PayrollPreview|null;loading:boolean;error:string|null}>({key:"",data:null,loading:false,error:null});
    const dirty=editing&&!committed&&JSON.stringify(values)!==JSON.stringify(initial);
    const navigation=useDocumentNavigationGuard(dirty||uncertain,{enabled:editing,isBusy:saving,pendingRef:inFlight,documentLabel:"payroll",discardMessage:uncertain?UNKNOWN_EXIT:undefined});
    const spec=payrollReadSpec(route,browse.tab,values.period_id,values.payment_date);
    const reads=usePayrollRead(spec,canView&&(!editing||canManage),inFlight,ownsDocument);
    const {data}=reads,run=data.run,entry=run?.entries.find(e=>e.id===route.entryId),profile=data.profiles?.find(p=>p.id===route.id),period=data.periods?.find(p=>p.id===route.id),payment=data.payments?.find(p=>p.id===route.id);
    const previewKey=JSON.stringify([values.period_id,values.currency,data.policy??null,data.profiles??null]);
    const defaultTab:PayrollTab=route.mode.startsWith("profile")?"profiles":route.mode.startsWith("period")?"periods":route.mode.startsWith("withholding")?"withholdings":"runs";
    const returnHref=safePayrollReturn(params.get("returnTo"),payrollBrowseHref(defaultTab));
    const thisHref=safePayrollReturn(pathname+(params.size?`?${params}`:""),payrollBrowseHref(browse.tab));
    const invalidatePreview=useCallback(()=>{previewEpoch.current++;},[]);
    useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;invalidatePreview();};},[invalidatePreview]);
    useEffect(()=>{
        if(!ownsDocument()||initialized.current||inFlight.current)return;
        const draft=route.mode==="profile_edit"&&profile?payrollProfileDraft(draftRef.current,profile):route.mode==="entry_edit"&&entry?payrollEntryDraft(draftRef.current,entry):null;
        if(!draft)return;
        let active=true;void Promise.resolve().then(()=>{if(!active||!ownsDocument()||initialized.current)return;initialized.current=true;draftRef.current=draft;setValues(draft);setInitial(draft);setFormInitialized(true);});return()=>{active=false;};
    },[route.mode,profile,entry,ownsDocument]);
    useEffect(()=>{if(route.mode==="register"&&!reads.anyLoading&&browse.focus)document.getElementById(`payroll-row-${browse.focus}`)?.focus();},[route.mode,reads.anyLoading,browse.focus]);
    function change<K extends keyof PayrollDraft>(field:K,value:PayrollDraft[K]) {
        if(!ownsDocument()||inFlight.current||committedRef.current||uncertainRef.current||editing&&!canManage)return;
        if(route.mode==="profile_edit"&&["employee_id","currency","pay_frequency","effective_from"].includes(field))return;
        if(route.mode==="entry_edit"&&field==="base_salary"&&!run?.policy_version_id)return;
        const next={...draftRef.current,[field]:value};draftRef.current=next;setValues(next);
        if(field==="period_id"||field==="currency"){previewEpoch.current++;setPreviewState({key:JSON.stringify([next.period_id,next.currency]),data:null,loading:false,error:null});setIssues([]);}
    }
    const preview=previewState.key===previewKey?previewState.data:null,previewing=previewState.key===previewKey&&previewState.loading,previewError=previewState.key===previewKey?previewState.error:null;
    const previewInputsValid=Boolean(canManage&&canView&&data.periods?.some(p=>p.id===values.period_id&&p.status==="open")&&data.meta?.currencies.includes(values.currency));
    async function requestPreview() {
        if(!ownsDocument()||uncertainRef.current||route.mode!=="run_new"||!previewInputsValid||inFlight.current||committedRef.current||draftRef.current!==values)return;
        const key=previewKey,fields=JSON.stringify([draftRef.current.period_id,draftRef.current.currency]),epoch=++previewEpoch.current;
        setPreviewState({key,data:null,loading:true,error:null});setError(null);setIssues([]);
        try {
            const result=await payrollRequest("/api/payroll/runs/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({period_id:values.period_id,currency:values.currency})});
            if(!ownsDocument()||!mounted.current||epoch!==previewEpoch.current||fields!==JSON.stringify([draftRef.current.period_id,draftRef.current.currency]))return;
            if(!isPayrollPreview(result)||result.ready&&result.calculation?.currency!==values.currency)throw new Error("The payroll preview response could not be verified. Request a new preview.");
            setPreviewState({key,data:result,loading:false,error:null});
        }catch(reason){if(!ownsDocument()||!mounted.current||epoch!==previewEpoch.current)return;setPreviewState({key,data:null,loading:false,error:reason instanceof Error?reason.message:"Payroll preview is unavailable."});if(reason instanceof PayrollRequestError){setIssues(reason.issues);if(reason.status===401)router.replace("/login");}}
    }
    const componentsValid=payrollComponentsValid(values.allowances)&&payrollComponentsValid(values.deductions);
    const ready=route.mode==="period_new"?canManage:reads.ready;
    const unlocked=route.mode!=="entry_edit"||run?.status==="draft";
    let fieldsValid=false;
    switch(route.mode) {
        case "profile_new":fieldsValid=Boolean(data.meta?.employees.some(e=>e.id===values.employee_id)&&data.meta.currencies.includes(values.currency)&&["monthly","weekly","biweekly"].includes(values.pay_frequency)&&positivePayrollAmount(values.base_salary)&&dateValue(values.effective_from)&&componentsValid);break;
        case "profile_edit":fieldsValid=Boolean(profile&&formInitialized&&positivePayrollAmount(values.base_salary)&&(!values.effective_to||dateValue(values.effective_to)&&values.effective_to>=profile.effective_from)&&componentsValid);break;
        case "period_new":fieldsValid=Boolean(values.name.trim()&&values.name.trim().length<=120&&dateValue(values.period_start)&&dateValue(values.period_end)&&values.period_end>=values.period_start&&dateValue(values.pay_date)&&values.pay_date>=values.period_end);break;
        case "run_new":fieldsValid=Boolean(previewInputsValid&&preview?.ready&&preview.calculation_hash&&!previewing);break;
        case "entry_edit":fieldsValid=Boolean(entry&&formInitialized&&unlocked&&componentsValid&&nonnegativePayrollAmount(values.tax_amount.trim()||"0")&&values.adjustment_reason.trim()&&values.adjustment_reason.trim().length<=2000&&(!run?.policy_version_id||nonnegativePayrollAmount(values.base_salary)));break;
        case "withholding_new":fieldsValid=Boolean(data.withholding&&dateValue(values.payment_date)&&positivePayrollAmount(String(data.withholding.liability_balance))&&positivePayrollAmount(values.amount)&&data.withholding.accounts.some(a=>a.id===values.account_id));break;
        case "policy_new":fieldsValid=Boolean(data.policy&&["manual","calendar_day","working_day"].includes(values.mode)&&dateValue(values.effective_from)&&values.effective_from>=data.policy.as_of&&(!values.weekly_anchor||dateValue(values.weekly_anchor))&&(!values.biweekly_anchor||dateValue(values.biweekly_anchor))&&values.activation_reason.trim()&&values.activation_reason.trim().length<=2000&&["fixed_latest","prorate_profile_segments"].includes(values.allowance_treatment)&&["fixed_latest","prorate_profile_segments"].includes(values.deduction_treatment)&&(values.mode!=="working_day"||values.weekdays.length&&new Set(values.weekdays).size===values.weekdays.length&&values.weekdays.every(v=>Number.isInteger(v)&&v>=0&&v<=6)&&["count_scheduled","exclude"].includes(values.holiday_treatment)));break;
        case "approve":fieldsValid=Boolean(run?.status==="draft"&&run.employee_count>0);break;
        case "pay":fieldsValid=Boolean(run?.status==="approved"&&data.meta?.accounts.some(a=>a.id===values.account_id&&a.is_active&&a.currency===run.currency&&a.account_type!=="credit_card"));break;
    }
    const canSubmit=documentScope===scope&&canManage&&ready&&fieldsValid&&!saving&&!committed&&!uncertain&&!policyRecovery;
    async function reloadPolicyContext() {
        if(!ownsDocument()||route.mode!=="policy_new"||!policyRecoveryRef.current||policyReloadingRef.current||inFlight.current||committedRef.current||uncertainRef.current)return;
        policyReloadingRef.current=true;refreshedPolicyKey.current="";setPolicyRecovery("reload");
        try {const loaded=await reads.load();if(!ownsDocument()||!mounted.current)return;if(loaded?.policy){refreshedPolicyKey.current=JSON.stringify(loaded.policy);setPolicyRecoveryContext(loaded.policy);setPolicyRecovery("review");}}
        finally {if(ownsDocument())policyReloadingRef.current=false;}
    }
    function acceptPolicyContext() {
        if(!ownsDocument()||uncertainRef.current||inFlight.current||policyRecovery!=="review"||policyReloadingRef.current||!reads.ready||!data.policy||JSON.stringify(data.policy)!==refreshedPolicyKey.current)return;
        policyRecoveryRef.current=false;setPolicyRecovery(null);setError(null);
    }
    function savedHref(id=savedId) {
        if(!canView)return "/dashboard";
        if(["entry_edit","approve","pay"].includes(route.mode))return route.mode==="entry_edit"?payrollHref(`runs/${encodeURIComponent(route.id)}/entries/${encodeURIComponent(route.entryId)}`,returnHref):payrollHref(`runs/${encodeURIComponent(route.id)}`,returnHref);
        if(route.mode==="policy_new")return payrollHref("policy",returnHref);
        const section=route.mode.startsWith("profile")?"profiles":route.mode==="period_new"?"periods":route.mode==="withholding_new"?"withholdings":"runs";
        return id?payrollHref(`${section}/${encodeURIComponent(id)}`,returnHref):payrollBrowseHref(defaultTab);
    }
    function confirmation() {
        if(route.mode==="approve"&&run)return `Approve ${run.run_number}?\n${run.employee_count} employees · net ${payrollMoney(run.net_total,run.currency)}.\nApproval records the payroll accrual and locks employee amounts. This does not pay the run.`;
        if(route.mode==="pay"&&run)return `Pay ${run.run_number}?\nNet ${payrollMoney(run.net_total,run.currency)} from ${data.meta?.accounts.find(a=>a.id===values.account_id)?.name??"selected account"}.\nThis posts the cash payment and settles payroll payable. Do not repeat an uncertain payment.`;
        if(route.mode==="withholding_new")return `Post withholding payment of ${payrollMoney(values.amount,data.withholding?.currency??"")} on ${values.payment_date}?\nFrom ${data.withholding?.accounts.find(a=>a.id===values.account_id)?.name??"selected account"}.\nThis settles an existing liability, not a new expense.`;
        if(route.mode==="policy_new")return `Activate a new payroll policy version from ${values.effective_from}?\nOnly new drafts whose period starts on or after the effective date use this version. Existing drafts and finalized runs are not recalculated.`;
        if(route.mode==="run_new"&&preview?.calculation)return `Create a draft for ${data.periods?.find(p=>p.id===values.period_id)?.name??values.period_id}?\n${preview.calculation.employee_count} employees · net ${payrollMoney(preview.calculation.net_total,preview.calculation.currency)}.\n${preview.policy_version>0?"The server will verify the reviewed inputs before creating this draft.":"Legacy manual creation uses the current salary-profile inputs at creation, which may differ from this preview; it does not enforce a reviewed-input digest."} No payment is made.`;
        return null;
    }
    async function save() {
        if(!ownsDocument()||!editing||!canSubmit||inFlight.current||committedRef.current||uncertainRef.current||policyRecoveryRef.current||draftRef.current!==values)return;
        const prompt=confirmation();if(prompt&&!window.confirm(prompt))return;
        if(!ownsDocument()||inFlight.current||committedRef.current||uncertainRef.current)return;
        const v=draftRef.current,payload=payrollWritePayload(route.mode,v,{run,policy:data.policy,previewHash:preview?.calculation_hash??undefined,previewVersion:preview?.policy_version});
        const path=route.mode==="profile_new"?"salary-profiles":route.mode==="profile_edit"?`salary-profiles/${encodeURIComponent(route.id)}`:route.mode==="period_new"?"periods":route.mode==="run_new"?"runs":route.mode==="entry_edit"?`runs/${encodeURIComponent(route.id)}/entries/${encodeURIComponent(route.entryId)}`:route.mode==="withholding_new"?"withholdings/payments":route.mode==="policy_new"?"policy-versions":`runs/${encodeURIComponent(route.id)}/${route.mode}`;
        previewEpoch.current++;inFlight.current=true;setSaving(true);setError(null);setIssues([]);setUncertain(false);
        try {
            const result=await payrollRequest("/api/payroll/"+path,{method:["profile_edit","entry_edit"].includes(route.mode)?"PATCH":"POST",headers:{"Content-Type":"application/json"},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
            if(!ownsDocument()||!mounted.current)return;
            committedRef.current=true;
            setSavedId(payrollRecord(result)&&typeof result.id==="string"?result.id:route.mode==="profile_edit"?route.id:null);
            setCommitted(true);inFlight.current=false;setSaving(false);navigation.markClean();
        }catch(reason){
            if(!ownsDocument()||!mounted.current)return;
            setError(reason instanceof Error?reason.message:"The response could not be confirmed. Review the current record before retrying.");
            uncertainRef.current=!(reason instanceof PayrollRequestError)||!reason.definiteRejection;
            setUncertain(uncertainRef.current);
            if(reason instanceof PayrollRequestError){setIssues(reason.issues);if(!uncertainRef.current&&route.mode==="policy_new"&&reason.status===409){policyRecoveryRef.current=true;refreshedPolicyKey.current="";setPolicyRecovery("reload");setPolicyRecoveryContext(data.policy??null);}if(!uncertainRef.current&&["PAYROLL_PREVIEW_STALE","PAYROLL_PREVIEW_REQUIRED","PAYROLL_SETUP_REQUIRED"].includes(reason.code??""))setPreviewState({key:previewKey,data:null,loading:false,error:"Request and review a fresh preview before another confirmation."});if(reason.status===401)router.replace("/login");}
        }finally{if(ownsDocument()){inFlight.current=false;if(mounted.current)setSaving(false);}}
    }
    return {...reads,policyRecovery,policyRecoveryContext,reloadPolicyContext,acceptPolicyContext,route,browse,editing,canView,canManage,timezone,today,values,change,dirty,saving,committed,error,issues,uncertain,preview,previewing,previewError,previewInputsValid,requestPreview,canSubmit,ready,unlocked,run,entry,profile,period,payment,returnHref,thisHref,save,
        verificationHref:["entry_edit","approve","pay"].includes(route.mode)?payrollHref(`runs/${encodeURIComponent(route.id)}`,returnHref):route.mode==="profile_edit"?payrollHref(`profiles/${encodeURIComponent(route.id)}`,returnHref):route.mode==="policy_new"?payrollHref("policy",returnHref):payrollBrowseHref(defaultTab),
        back:()=>{if(!ownsDocument()||inFlight.current)return;if(uncertainRef.current){if(!window.confirm(UNKNOWN_EXIT))return;return navigation.navigate(returnHref,{discard:true});}return editing?navigation.navigate(returnHref):router.push(returnHref);},openSaved:()=>{if(ownsDocument()&&committedRef.current)return navigation.navigate(savedHref(),{replace:true,discard:true});},
        changeTab:(tab:PayrollTab)=>{if(ownsDocument()&&!inFlight.current&&!uncertainRef.current)router.push(payrollBrowseHref(tab));},
        readHref:(suffix:string)=>payrollHref(suffix,thisHref),nativeHref:(suffix:string)=>payrollHref(suffix,thisHref),
        openRead:(suffix:string)=>{if(ownsDocument()&&!inFlight.current&&!uncertainRef.current)router.push(payrollHref(suffix,thisHref));}};
}
export type PayrollWorkspaceState=ReturnType<typeof usePayrollWorkspace>;
