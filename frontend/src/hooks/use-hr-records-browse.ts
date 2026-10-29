"use client";
import { useLayoutEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { isHRTimeMeta, validHRAccess } from "@/components/hr-time/hr-time-model";
import { recordsPageValidator, recordText } from "@/components/hr-records/records-model";
import { previousRecordsCursor, recordsApi, recordsBrowse, recordsDocumentHref, recordsHref, recordsRoute, rememberRecordsCursor, safeRecordsReturn, type RecordsBrowse } from "@/lib/hr-records-navigation";
import { useHRTimeLifetime, useHRTimeResource } from "./use-hr-time-resource";
export function useHRRecordsBrowse(blocked = false) {
  const session=useDashboardSession(), cap=useHRAccess(), router=useRouter(), query=useSearchParams(), pathname=usePathname();
  const queryString=query.toString();
  const access=validHRAccess(cap.access) ? cap.access : null;
  const scope=JSON.stringify([session.tenant?.organization.id,session.tenant?.membership_id,session.tenant?.role_id,session.tenant?.status,session.tenant?.permissions,session.profile?.email,session.loading,cap.loading,access]);
  const canView=Boolean(session.tenant) && !session.loading && !cap.loading && access?.can_view === true;
  const canManage=canView && access?.can_manage === true, route=recordsRoute(pathname), parsed=recordsBrowse(queryString);
  const browse={...parsed,view:route.mode === "document" ? route.kind : parsed.view};
  const lifetime=useHRTimeLifetime(JSON.stringify([scope,pathname,queryString]));
  const validator=useMemo(()=>recordsPageValidator(browse.view,route.id),[browse.view,route.id]);
  const page=useHRTimeResource(scope,recordsApi(browse,route.id),canView && route.mode !== "unavailable",validator);
  const meta=useHRTimeResource(scope,"/api/hr/meta",canManage && route.mode === "register",isHRTimeMeta);
  const navigating=useRef(false); useLayoutEffect(()=>{navigating.current=false;},[pathname,queryString]);
  const loaded=page.value?.items ?? [], needle=browse.search.trim().toLowerCase();
  const rows=loaded.filter(row=>!needle || recordText(row).toLowerCase().includes(needle));
  const previous=previousRecordsCursor(scope,browse), returnHref=safeRecordsReturn(query.get("returnTo"));
  function change(patch:Partial<RecordsBrowse>) { if(blocked || !lifetime.current())return; router.push(recordsHref({...browse,...patch,cursor:Object.keys(patch).some(k=>k!=="search") ? "" : browse.cursor})); }
  function next() { if(blocked || navigating.current || !lifetime.current() || !page.isReady(page.receipt) || !page.value?.next_cursor)return; navigating.current=true; rememberRecordsCursor(scope,browse,page.value.next_cursor); router.push(recordsHref({...browse,cursor:page.value.next_cursor})); }
  function back() { if(blocked || navigating.current || !lifetime.current() || previous === undefined)return; navigating.current=true; router.push(recordsHref({...browse,cursor:previous})); }
  return {access,canView,canManage,accessLoading:session.loading || cap.loading,accessError:cap.error,scope,route,browse,page,meta,rows,loaded,previous,returnHref,change,next,back,current:lifetime.current,documentHref:(id:string)=>recordsDocumentHref(browse.view,id,recordsHref(browse)),refresh:()=>Promise.all([page.refresh(),meta.refresh()])};
}
export type HRRecordsBrowseState=ReturnType<typeof useHRRecordsBrowse>;
