from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}")
    file.write_text(text.replace(old, new, count))


replace(
    "backend/app/api/v1/crm_client_workspace.py",
    '''    access = ClientWorkspaceAccess(\n        quotations=_can(permissions, "quotations.view"),\n        orders=_can(permissions, "orders.view"),\n        projects=_can(permissions, "projects.view"),\n        finance=_can(permissions, "finance.view"),\n    )''',
    '''    access = ClientWorkspaceAccess(\n        clients_manage=_can(permissions, "clients.manage"),\n        quotations=_can(permissions, "quotations.view"),\n        quotations_manage=_can(permissions, "quotations.manage"),\n        orders=_can(permissions, "orders.view"),\n        projects=_can(permissions, "projects.view"),\n        finance=_can(permissions, "finance.view"),\n        finance_manage=_can(permissions, "finance.manage"),\n    )''',
)
replace(
    "backend/app/api/v1/crm_client_workspace.py",
    '                href="/dashboard/orders",',
    '                href=f"/dashboard/orders?order_id={item.id}",',
)

replace(
    "backend/app/api/v1/router.py",
    'from app.api.v1.crm_clients import router as crm_clients_router\n',
    'from app.api.v1.crm_clients import router as crm_clients_router\nfrom app.api.v1.crm_client_workspace import router as crm_client_workspace_router\n',
)
replace(
    "backend/app/api/v1/router.py",
    'api_router.include_router(crm_clients_router)\n',
    'api_router.include_router(crm_clients_router)\napi_router.include_router(crm_client_workspace_router)\n',
)

replace(
    "frontend/src/app/dashboard/clients/page.tsx",
    '''  useEffect(() => {\n    if (loading) return;\n    void loadList(true);\n    // loading is intentionally excluded to avoid an extra bootstrap request\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [queryString, loadList]);\n''',
    '''  useEffect(() => {\n    if (loading) return;\n    void loadList(true);\n    // loading is intentionally excluded to avoid an extra bootstrap request\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [queryString, loadList]);\n\n  useEffect(() => {\n    const requestedEditId = new URLSearchParams(window.location.search).get("edit");\n    if (requestedEditId) void openClient(requestedEditId);\n    // Open-on-arrival only. Subsequent drawer state is local to this page.\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, []);\n''',
)
replace(
    "frontend/src/app/dashboard/clients/page.tsx",
    '''<td className="px-6 py-4 text-right"><button onClick={() => void openClient(client.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Open</button></td>''',
    '''<td className="px-6 py-4 text-right"><div className="inline-flex gap-2"><button onClick={() => router.push(`/dashboard/clients/${encodeURIComponent(client.id)}`)} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white">View</button><button onClick={() => void openClient(client.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Edit</button></div></td>''',
)

replace(
    "frontend/src/app/dashboard/quotations/quotation-workspace.tsx",
    '''    const p = new URLSearchParams(window.location.search);\n    const leadId = p.get("lead_id");\n    const preClient = p.get("client_id");\n    if (leadId) {''',
    '''    const p = new URLSearchParams(window.location.search);\n    const quotationId = p.get("quotation_id");\n    const leadId = p.get("lead_id");\n    const preClient = p.get("client_id");\n    if (quotationId) { void openDetail(quotationId); return; }\n    if (leadId) {''',
)

replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    'import { useRouter } from "next/navigation";',
    'import { useRouter, useSearchParams } from "next/navigation";',
)
replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    '''export default function FinancePage() {\n  const router = useRouter();\n''',
    '''export default function FinancePage() {\n  const router = useRouter();\n  const searchParams = useSearchParams();\n  const requestedClientId = searchParams.get("client_id");\n''',
)
replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    '''  useEffect(() => { void loadCore(true); },[loadCore]);\n''',
    '''  useEffect(() => { void loadCore(true); },[loadCore]);\n  useEffect(() => {\n    if (!requestedClientId || loading) return;\n    if (meta.clients.some((item) => item.id === requestedClientId)) setModal("invoice");\n  }, [loading, meta.clients, requestedClientId]);\n''',
)
replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    '''{modal === "invoice" ? <InvoiceCreateModal saving={saving} meta={meta} api={api} onClose={()=>setModal(null)}''',
    '''{modal === "invoice" ? <InvoiceCreateModal saving={saving} meta={meta} initialClientId={requestedClientId} api={api} onClose={()=>setModal(null)}''',
)
replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    '''function InvoiceCreateModal({saving,meta,api,onClose,onSaved,onError}:{saving:boolean;meta:Meta;api:(p:string,i?:RequestInit)=>Promise<unknown>;onClose:()=>void;onSaved:()=>Promise<void>;onError:(v:string|null)=>void}) {\n  const [source,setSource]=useState<InvoiceSource>("order"); const [sourceId,setSourceId]=useState(""); const [clientId,setClientId]=useState("");''',
    '''function InvoiceCreateModal({saving,meta,initialClientId,api,onClose,onSaved,onError}:{saving:boolean;meta:Meta;initialClientId?:string|null;api:(p:string,i?:RequestInit)=>Promise<unknown>;onClose:()=>void;onSaved:()=>Promise<void>;onError:(v:string|null)=>void}) {\n  const [source,setSource]=useState<InvoiceSource>(initialClientId ? "client" : "order"); const [sourceId,setSourceId]=useState(""); const [clientId,setClientId]=useState(initialClientId ?? "");''',
)

replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    'type Access = { quotations: boolean; orders: boolean; projects: boolean; finance: boolean };',
    'type Access = { clients_manage: boolean; quotations: boolean; quotations_manage: boolean; orders: boolean; projects: boolean; finance: boolean; finance_manage: boolean };',
)
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    '''        <Link href={`/dashboard/clients?edit=${encodeURIComponent(client.id)}`} className="inline-flex h-11 items-center rounded-xl border bg-white px-4 text-sm font-semibold">Edit client</Link>\n        {access.quotations && client.status === "active" ?''',
    '''        {access.clients_manage ? <Link href={`/dashboard/clients?edit=${encodeURIComponent(client.id)}`} className="inline-flex h-11 items-center rounded-xl border bg-white px-4 text-sm font-semibold">Edit client</Link> : null}\n        {access.quotations_manage && client.status === "active" ?''',
)
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    '{access.finance && client.status === "active" ? <Link href={`/dashboard/finance?client_id=${encodeURIComponent(client.id)}`}',
    '{access.finance_manage && client.status === "active" ? <Link href={`/dashboard/finance?client_id=${encodeURIComponent(client.id)}`}',
)

print("Client 360 integration patch applied")
