"use client";
import {usePathname,useSearchParams} from 'next/navigation';
import {useHRSettingsIdentity} from './use-hr-settings-identity';
import {useHRTimeResource} from './use-hr-time-resource';
import * as M from '@/components/hr-talent-hiring/model';
/** This workspace intentionally has no write, conversion, clipboard or invitation mechanism. */
export function useHRTalentHiring(){const identity=useHRSettingsIdentity(),path=usePathname(),query=useSearchParams(),route=M.hiringRoute(path,new URLSearchParams(query.toString())),allowed=identity.canView&&route.valid;
 const jobs=useHRTimeResource(identity.scope,'/api/hr/jobs',allowed&&route.view==='jobs',M.jobs);
 const candidates=useHRTimeResource(identity.scope,'/api/hr/candidates',allowed&&route.view==='candidates',M.candidates);
 return {identity,path,query,route,jobs,candidates,resource:route.view==='jobs'?jobs:candidates,back:M.hiringReturn(query.get('returnTo'))};}
