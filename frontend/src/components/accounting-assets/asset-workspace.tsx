"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { safeAssetReturn } from "@/lib/asset-navigation";
import { AssetRegister } from "./asset-register";
import { AssetDocument } from "./asset-document";
import { AssetCreateEditor, AssetDepreciationEditor } from "./asset-editors";
import { AssetState } from "./asset-ui";
import "@/components/accounting-accounts/account-workspace.css";
import "./asset.css";

export function AssetWorkspace() {
  const {tenant,loading}=useDashboardSession(),pathname=usePathname();
  if(loading)return <RelationshipPage className="aa-workspace fa-workspace"><AssetState loading title="Loading fixed asset workspace…"/></RelationshipPage>;
  return <RelationshipPage className="aa-workspace fa-workspace"><AssetContent key={`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`}/></RelationshipPage>;
}
function AssetContent(){const pathname=usePathname(),query=useSearchParams(),params=useParams<{assetId?:string}>(),returnHref=safeAssetReturn(query.get("returnTo"));if(pathname.endsWith("/new"))return <AssetCreateEditor returnHref={returnHref}/>;if(pathname.endsWith("/depreciation"))return <AssetDepreciationEditor returnHref={returnHref}/>;if(params.assetId)return <AssetDocument assetId={params.assetId} returnHref={returnHref}/>;return <AssetRegister/>;}
