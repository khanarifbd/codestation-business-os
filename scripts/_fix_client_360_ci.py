from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise RuntimeError(f"{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}")
    file.write_text(text.replace(old, new, count))


replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    'import { useRouter, useSearchParams } from "next/navigation";',
    'import { useRouter } from "next/navigation";',
)
replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    '''export default function FinancePage() {\n  const router = useRouter();\n  const searchParams = useSearchParams();\n  const requestedClientId = searchParams.get("client_id");\n  const [tab,setTab] = useState<Tab>("invoices");''',
    '''export default function FinancePage() {\n  const router = useRouter();\n  const [requestedClientId,setRequestedClientId] = useState<string|null>(null);\n  const [tab,setTab] = useState<Tab>("invoices");''',
)
replace(
    "frontend/src/app/dashboard/finance/page.tsx",
    '''  useEffect(() => { void loadCore(true); },[loadCore]);\n  useEffect(() => {\n    if (!requestedClientId || loading) return;\n    if (meta.clients.some((item) => item.id === requestedClientId)) setModal("invoice");\n  }, [loading, meta.clients, requestedClientId]);\n''',
    '''  useEffect(() => { void loadCore(true); },[loadCore]);\n  useEffect(() => {\n    setRequestedClientId(new URLSearchParams(window.location.search).get("client_id"));\n  }, []);\n  useEffect(() => {\n    if (!requestedClientId || loading) return;\n    if (meta.clients.some((item) => item.id === requestedClientId)) setModal("invoice");\n  }, [loading, meta.clients, requestedClientId]);\n''',
)

replace(
    "backend/app/api/v1/crm_client_workspace.py",
    '''                Payment.organization_id == organization_id,\n                Invoice.organization_id == organization_id,\n                Invoice.client_id == client_id,\n''',
    '''                Payment.organization_id == organization_id,\n                Payment.status == "confirmed",\n                Invoice.organization_id == organization_id,\n                Invoice.client_id == client_id,\n''',
)

# The workspace fetch is intentionally bounded; section headings should not imply the loaded rows are the all-time total.
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    'return <div className="mt-5 space-y-5">{access.quotations ? <Section title={`Quotations · ${quotations.length}`}>',
    'return <div className="mt-5 space-y-5">{access.quotations ? <Section title="Recent quotations">',
)
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    ':</div></Section> : null}{access.orders ? <Section title={`Orders · ${orders.length}`}>',
    ':</div></Section> : null}{access.orders ? <Section title="Recent orders">',
)
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    'return <Section className="mt-5" title={`Projects · ${projects.length}`}>',
    'return <Section className="mt-5" title="Recent projects">',
)
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    'return <div className="mt-5 space-y-5"><Section title={`Invoices · ${invoices.length}`}>',
    'return <div className="mt-5 space-y-5"><Section title="Recent invoices">',
)
replace(
    "frontend/src/app/dashboard/clients/[clientId]/page.tsx",
    '</div></Section><Section title={`Payments · ${payments.length}`}>',
    '</div></Section><Section title="Recent payments">',
)

print("Client 360 CI fixes applied")
