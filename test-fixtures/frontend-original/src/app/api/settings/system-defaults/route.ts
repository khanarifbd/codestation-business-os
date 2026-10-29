import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth-session";
import { authenticatedBackendFetch } from "@/lib/authenticated-backend";

async function proxy(request: NextRequest, method: 'GET'|'PATCH') {
 const organizationId=request.cookies.get('organization_id')?.value;
 if(!organizationId) return NextResponse.json({detail:'No active workspace selected'},{status:409});
 const init: RequestInit={method,headers:{'X-Organization-ID':organizationId}};
 if(method==='PATCH'){init.headers={...init.headers,'Content-Type':'application/json'};init.body=await request.text();}
 const {upstream,rotatedTokens}=await authenticatedBackendFetch(request,'/company-settings/system-defaults',init);
 const response=NextResponse.json(await upstream.json(),{status:upstream.status}); if(rotatedTokens) setAuthCookies(response,rotatedTokens); return response;
}
export async function GET(request:NextRequest){return proxy(request,'GET');}
export async function PATCH(request:NextRequest){return proxy(request,'PATCH');}
