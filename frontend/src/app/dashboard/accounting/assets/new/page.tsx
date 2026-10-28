import { Suspense } from "react";
import { AssetWorkspace } from "@/components/accounting-assets/asset-workspace";

export default function Page() { return <Suspense fallback={null}><AssetWorkspace/></Suspense>; }
