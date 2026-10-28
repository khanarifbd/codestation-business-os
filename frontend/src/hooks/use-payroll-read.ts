"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {isPayrollResource,isPayrollRun,type PayrollResource,type PayrollResources,type PayrollTab} from "@/components/payroll/payroll-model";
import {payrollRequest,PayrollRequestError} from "@/components/payroll/payroll-api";
import type {PayrollRoute} from "@/lib/payroll-navigation";
export type PayrollReadSpec=Partial<Record<PayrollResource,string>>;
export function payrollReadSpec(route:PayrollRoute,tab:PayrollTab,periodId:string,paymentDate:string):PayrollReadSpec {
    const root="/api/payroll",periods=root+"/periods",profiles=root+"/salary-profiles",policy=root+"/policy";
    switch(route.mode) {
        case "register":return tab==="profiles"?{profiles}:tab==="periods"?{periods}:tab==="withholdings"?{payments:root+"/withholdings/payments",...(paymentDate?{withholding:root+"/withholdings/meta?"+new URLSearchParams({payment_date:paymentDate})}:{})}:{runs:root+"/runs",policy};
        case "run":case "entry":case "entry_edit":case "approve":return {run:root+"/runs/"+encodeURIComponent(route.id)};
        case "pay":return {run:root+"/runs/"+encodeURIComponent(route.id),meta:root+"/meta"};
        case "profile":case "profile_edit":return {profiles};
        case "profile_new":return {meta:root+"/meta"};
        case "period":return {periods};
        case "withholding":return {payments:root+"/withholdings/payments"};
        case "withholding_new":return paymentDate?{withholding:root+"/withholdings/meta?"+new URLSearchParams({payment_date:paymentDate})}:{};
        case "policy":case "policy_new":return {policy};
        case "run_new":return {meta:root+"/meta",periods,profiles,policy:policy+(periodId?"?"+new URLSearchParams({period_id:periodId}):"")};
        default:return {};
    }
}
type ReadState={url:string;data:unknown;loading:boolean;error:string|null};
export function usePayrollRead(spec:PayrollReadSpec,enabled:boolean,pendingRef:{readonly current:boolean}) {
    const router=useRouter(),mounted=useRef(true),epoch=useRef(0),key=JSON.stringify(spec);
    const [states,setStates]=useState<Partial<Record<PayrollResource,ReadState>>>({});
    const load=useCallback(async()=> {
        if(!enabled||pendingRef.current)return null;
        const generation=++epoch.current,paths=JSON.parse(key) as PayrollReadSpec;
        const active=()=>mounted.current&&epoch.current===generation;
        const loaded:Partial<PayrollResources>={};
        await Promise.all((Object.entries(paths) as [PayrollResource,string][]).map(async([resource,url])=>{
            if(!active())return;
            setStates(old=>({...old,[resource]:{url,data:null,loading:true,error:null}}));
            try {const result=await payrollRequest(url);if(!active())return;if(!isPayrollResource(resource,result))throw new Error("This payroll response could not be verified. Retry loading.");if(resource==="run"&&(!isPayrollRun(result)||result.id!==decodeURIComponent(url.split("/runs/")[1])||result.employee_count!==result.entries.length))throw new Error("The returned payroll run does not match this document. Retry loading.");Object.assign(loaded,{[resource]:result});setStates(old=>({...old,[resource]:{url,data:result,loading:false,error:null}}));}
            catch(reason){if(!active())return;setStates(old=>({...old,[resource]:{url,data:null,loading:false,error:reason instanceof Error?reason.message:"Payroll information is unavailable."}}));if(reason instanceof PayrollRequestError&&reason.status===401)router.replace("/login");}
        }));
        return active()?loaded:null;
    },[enabled,key,pendingRef,router]);
    const invalidateReads=useCallback(()=>{epoch.current++;},[]);
    useEffect(()=>{mounted.current=true;let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;mounted.current=false;invalidateReads();};},[load,invalidateReads]);
    const data:Partial<PayrollResources>={},errors:Partial<Record<PayrollResource,string>>={},loading:Partial<Record<PayrollResource,boolean>>={};
    for(const [resource,url] of Object.entries(spec) as [PayrollResource,string][]) {
        const state=states[resource];loading[resource]=enabled&&(!state||state.url!==url||state.loading);
        if(state?.url===url){if(state.error)errors[resource]=state.error;else if(!state.loading&&state.data!==null)Object.assign(data,{[resource]:state.data});}
    }
    return {data,errors,loading,load,ready:enabled&&Object.keys(spec).every(resource=>resource in data),anyLoading:Object.values(loading).some(Boolean)};
}
