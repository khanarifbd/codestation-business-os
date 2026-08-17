from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"Expected snippet not found in {path}: {old[:240]!r}")
    path.write_text(text.replace(old, new, 1))


# Backend: safe hard-delete endpoints and color validation.
crm_api = Path("backend/app/api/v1/crm.py")
text = crm_api.read_text()
text = text.replace(
    "from fastapi import APIRouter, Depends, HTTPException, Query, Request, status",
    "from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status",
    1,
)
if '@router.delete("/settings/statuses/{status_id}"' not in text:
    text += '''\n\n@router.delete("/settings/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)\ndef delete_lead_status(\n    status_id: str,\n    request: Request,\n    db: DbSession,\n    tenant: CrmManager,\n) -> Response:\n    item = db.scalar(\n        select(LeadStatus).where(\n            LeadStatus.id == status_id,\n            LeadStatus.organization_id == tenant.organization_id,\n        )\n    )\n    if item is None:\n        raise HTTPException(status_code=404, detail="Lead status not found")\n    if item.is_default:\n        raise HTTPException(status_code=409, detail="Default lead status cannot be deleted")\n\n    lead_count = db.scalar(\n        select(func.count()).select_from(Lead).where(\n            Lead.organization_id == tenant.organization_id,\n            Lead.status_id == item.id,\n        )\n    ) or 0\n    if lead_count:\n        raise HTTPException(\n            status_code=409,\n            detail=f"This lead status is used by {lead_count} lead(s). Disable it instead to preserve lead history.",\n        )\n\n    before = LeadStatusRead.model_validate(item).model_dump(mode="json")\n    db.delete(item)\n    record_activity(\n        db,\n        action="crm.lead_status.deleted",\n        scope="tenant",\n        actor_user_id=tenant.user_id,\n        organization_id=tenant.organization_id,\n        entity_type="lead_status",\n        entity_id=item.id,\n        before=before,\n        after=None,\n        message=f"Lead status deleted: {item.name}",\n        request=request,\n    )\n    db.commit()\n    return Response(status_code=status.HTTP_204_NO_CONTENT)\n\n\n@router.delete("/settings/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)\ndef delete_lead_source(\n    source_id: str,\n    request: Request,\n    db: DbSession,\n    tenant: CrmManager,\n) -> Response:\n    item = db.scalar(\n        select(LeadSource).where(\n            LeadSource.id == source_id,\n            LeadSource.organization_id == tenant.organization_id,\n        )\n    )\n    if item is None:\n        raise HTTPException(status_code=404, detail="Lead source not found")\n\n    lead_count = db.scalar(\n        select(func.count()).select_from(Lead).where(\n            Lead.organization_id == tenant.organization_id,\n            Lead.source_id == item.id,\n        )\n    ) or 0\n    if lead_count:\n        raise HTTPException(\n            status_code=409,\n            detail=f"This lead source is used by {lead_count} lead(s). Disable it instead to preserve lead history.",\n        )\n\n    before = LeadSourceRead.model_validate(item).model_dump(mode="json")\n    db.delete(item)\n    record_activity(\n        db,\n        action="crm.lead_source.deleted",\n        scope="tenant",\n        actor_user_id=tenant.user_id,\n        organization_id=tenant.organization_id,\n        entity_type="lead_source",\n        entity_id=item.id,\n        before=before,\n        after=None,\n        message=f"Lead source deleted: {item.name}",\n        request=request,\n    )\n    db.commit()\n    return Response(status_code=status.HTTP_204_NO_CONTENT)\n'''
crm_api.write_text(text)

schema = Path("backend/app/schemas/crm.py")
replace_once(
    schema,
    'color: str | None = Field(default=None, max_length=16)',
    'color: str | None = Field(default=None, max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")',
)
replace_once(
    schema,
    'color: str | None = Field(default=None, max_length=16)',
    'color: str | None = Field(default=None, max_length=16, pattern=r"^#[0-9A-Fa-f]{6}$")',
)

# Frontend: replace the pipeline settings workspace with edit/delete UX and a real color picker.
page = Path("frontend/src/app/dashboard/crm/page.tsx")
page_text = page.read_text()
start = page_text.index("function PipelineStatuses(")
end = page_text.index("function Modal(", start)
replacement = r'''function ColorPickerField({ label, name, defaultValue = "#64748b" }: { label: string; name: string; defaultValue?: string | null }) {
  const value = defaultValue && /^#[0-9A-Fa-f]{6}$/.test(defaultValue) ? defaultValue : "#64748b";
  return <label className="block text-sm font-medium">{label}<input aria-label={label} name={name} type="color" defaultValue={value} className="mt-2 h-11 w-full cursor-pointer rounded-xl border border-neutral-200 bg-white p-1.5" /></label>;
}

function PipelineStatuses({ statuses, saving, run, api }: { statuses: LeadStatus[]; saving: boolean; run: (work: () => Promise<void>, success: string, policy?: RefreshPolicy) => Promise<void>; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteItem = statuses.find((item) => item.id === deleteId) ?? null;
  const categories: Array<[string, string]> = [["open", "Open"], ["qualified", "Qualified"], ["won", "Won"], ["lost", "Lost"]];

  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <div className="flex items-center gap-2"><Settings2 className="size-4" /><h2 className="font-semibold">Lead statuses</h2></div>
    <p className="mt-1 text-sm text-neutral-500">Create, rename and organize the stages used in your company pipeline.</p>
    <form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/settings/statuses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), category: text(form, "category") ?? "open", color: text(form, "color"), sort_order: 100 }) }); formElement.reset(); }, "Lead status created", "meta"); }} className="mt-5 grid gap-3 sm:grid-cols-[1fr_150px_120px_auto]">
      <Field label="Name" name="name" required />
      <SelectField label="Category" name="category" options={categories} defaultValue="open" />
      <ColorPickerField label="Color" name="color" defaultValue="#64748b" />
      <button disabled={saving} className="mt-7 h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Add</button>
    </form>

    <div className="mt-5 divide-y rounded-xl border">
      {statuses.map((item) => editingId === item.id ? <form key={item.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await api(`/settings/statuses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), category: text(form, "category"), color: text(form, "color") }) }); setEditingId(null); }, "Lead status updated", "meta"); }} className="grid gap-3 p-4 md:grid-cols-[minmax(180px,1fr)_150px_110px_auto] md:items-end">
        <Field label="Name" name="name" required defaultValue={item.name} />
        <SelectField label="Category" name="category" options={categories} defaultValue={item.category} />
        <ColorPickerField label="Color" name="color" defaultValue={item.color} />
        <div className="flex gap-2 pb-0.5"><button disabled={saving} className="h-10 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-50">Save</button><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="h-10 rounded-lg border px-3 text-xs font-semibold">Cancel</button></div>
      </form> : <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color ?? "#a3a3a3" }} />{item.name}{item.is_default ? <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Default</span> : null}{!item.is_active ? <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Disabled</span> : null}</p><p className="mt-1 text-xs capitalize text-neutral-400">{item.category}</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => setEditingId(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Edit</button><button type="button" disabled={saving || item.is_default} title={item.is_default ? "The default lead status must remain active" : undefined} onClick={() => void run(() => api(`/settings/statuses/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }).then(() => undefined), item.is_active ? "Lead status disabled" : "Lead status enabled", "meta")} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">{item.is_active ? "Disable" : "Enable"}</button><button type="button" disabled={saving || item.is_default} title={item.is_default ? "Default lead status cannot be deleted" : undefined} onClick={() => setDeleteId(item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-40">Delete</button></div>
      </div>)}
    </div>

    {deleteItem ? <DecisionModal title="Delete lead status" onClose={() => !saving && setDeleteId(null)}><p className="text-sm leading-6 text-neutral-600">Delete <span className="font-semibold text-neutral-900">{deleteItem.name}</span>? This is only allowed when no existing lead uses this status. If it is already in use, disable it instead so historical leads keep their pipeline stage.</p><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setDeleteId(null)} className="h-10 rounded-lg border px-4 text-sm font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void run(async () => { await api(`/settings/statuses/${deleteItem.id}`, { method: "DELETE" }); setDeleteId(null); }, "Lead status deleted", "meta")} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Delete status</button></div></DecisionModal> : null}
  </section>;
}

function PipelineSources({ sources, saving, run, api }: { sources: LeadSource[]; saving: boolean; run: (work: () => Promise<void>, success: string, policy?: RefreshPolicy) => Promise<void>; api: (path: string, init?: RequestInit) => Promise<unknown> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deleteItem = sources.find((item) => item.id === deleteId) ?? null;

  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <div className="flex items-center gap-2"><Target className="size-4" /><h2 className="font-semibold">Lead sources</h2></div>
    <p className="mt-1 text-sm text-neutral-500">Manage where opportunities come from, such as your website, referrals or marketplaces.</p>
    <form onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void run(async () => { await api("/settings/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name"), sort_order: 100 }) }); formElement.reset(); }, "Lead source created", "meta"); }} className="mt-5 flex items-end gap-3"><div className="min-w-0 flex-1"><Field label="Source name" name="name" required /></div><button disabled={saving} className="h-11 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50">Add</button></form>

    <div className="mt-5 divide-y rounded-xl border">
      {sources.map((item) => editingId === item.id ? <form key={item.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await api(`/settings/sources/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: text(form, "name") }) }); setEditingId(null); }, "Lead source updated", "meta"); }} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><Field label="Source name" name="name" required defaultValue={item.name} /></div><div className="flex gap-2 pb-0.5"><button disabled={saving} className="h-10 rounded-lg bg-neutral-950 px-3 text-xs font-semibold text-white disabled:opacity-50">Save</button><button type="button" disabled={saving} onClick={() => setEditingId(null)} className="h-10 rounded-lg border px-3 text-xs font-semibold">Cancel</button></div>
      </form> : <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="flex items-center gap-2 text-sm font-medium">{item.name}{!item.is_active ? <span className="rounded-full border bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Disabled</span> : null}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={saving} onClick={() => setEditingId(item.id)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-40">Edit</button><button type="button" disabled={saving} onClick={() => void run(() => api(`/settings/sources/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: !item.is_active }) }).then(() => undefined), item.is_active ? "Lead source disabled" : "Lead source enabled", "meta")} className="rounded-lg border px-3 py-2 text-xs font-semibold">{item.is_active ? "Disable" : "Enable"}</button><button type="button" disabled={saving} onClick={() => setDeleteId(item.id)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 disabled:opacity-40">Delete</button></div></div>)}
    </div>

    {deleteItem ? <DecisionModal title="Delete lead source" onClose={() => !saving && setDeleteId(null)}><p className="text-sm leading-6 text-neutral-600">Delete <span className="font-semibold text-neutral-900">{deleteItem.name}</span>? If an existing lead already uses this source, Business OS will block deletion and you can disable it instead to preserve lead history.</p><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setDeleteId(null)} className="h-10 rounded-lg border px-4 text-sm font-semibold">Cancel</button><button type="button" disabled={saving} onClick={() => void run(async () => { await api(`/settings/sources/${deleteItem.id}`, { method: "DELETE" }); setDeleteId(null); }, "Lead source deleted", "meta")} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">Delete source</button></div></DecisionModal> : null}
  </section>;
}

'''
page.write_text(page_text[:start] + replacement + page_text[end:])

# Permanent regression verification for edit/delete constraints.
verify = Path("backend/scripts/verify_crm_settings_management.py")
verify.write_text(r'''from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.crm import (
    create_lead_source,
    create_lead_status,
    delete_lead_source,
    delete_lead_status,
    update_lead_source,
    update_lead_status,
)
from app.db.session import SessionLocal, engine
from app.models.crm import LeadSource, LeadStatus
from app.schemas.crm import LeadSourceCreate, LeadSourceUpdate, LeadStatusCreate, LeadStatusUpdate


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str


def req(method: str, path: str) -> Request:
    return Request({"type": "http", "method": method, "path": path, "raw_path": path.encode(), "headers": [], "query_string": b"", "scheme": "https", "server": ("testserver", 443), "client": ("127.0.0.1", 50000)})


def expect(status_code: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != status_code:
            raise AssertionError(f"Expected HTTP {status_code}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {status_code}, but request succeeded")


def main() -> None:
    marker = uuid4().hex[:8]
    lead_id = str(uuid4())
    now = datetime.now(timezone.utc)
    with engine.connect() as connection:
        fixture = connection.execute(text("""
            SELECT o.id AS organization_id, o.created_by_user_id AS user_id,
                   (SELECT id FROM lead_statuses s WHERE s.organization_id=o.id AND s.is_default=true LIMIT 1) AS default_status_id
            FROM organizations o
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(str(fixture["organization_id"]), str(fixture["user_id"]))
    db = SessionLocal()
    try:
        status_item = create_lead_status(
            LeadStatusCreate(name=f"CI Editable {marker}", color="#123456", category="open"),
            req("POST", "/crm/settings/statuses"), db, tenant,  # type: ignore[arg-type]
        )
        status_item = update_lead_status(
            status_item.id,
            LeadStatusUpdate(name=f"CI Edited {marker}", color="#abcdef", category="qualified"),
            req("PATCH", f"/crm/settings/statuses/{status_item.id}"), db, tenant,  # type: ignore[arg-type]
        )
        if status_item.name != f"CI Edited {marker}" or status_item.color != "#abcdef" or status_item.category != "qualified":
            raise AssertionError(f"lead status edit failed: {status_item}")

        source_item = create_lead_source(
            LeadSourceCreate(name=f"CI Source {marker}"),
            req("POST", "/crm/settings/sources"), db, tenant,  # type: ignore[arg-type]
        )
        source_item = update_lead_source(
            source_item.id,
            LeadSourceUpdate(name=f"CI Source Edited {marker}"),
            req("PATCH", f"/crm/settings/sources/{source_item.id}"), db, tenant,  # type: ignore[arg-type]
        )
        if source_item.name != f"CI Source Edited {marker}":
            raise AssertionError(f"lead source edit failed: {source_item}")

        with engine.begin() as connection:
            connection.execute(text("""
                INSERT INTO leads
                    (id, organization_id, lead_code, lead_type, contact_name, status_id, source_id,
                     probability_percent, currency, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :lead_code, 'company', 'CRM Settings CI', :status_id, :source_id,
                     0, 'USD', :now, :now)
            """), {"id": lead_id, "organization_id": tenant.organization_id, "lead_code": f"LEAD-SET-{marker}", "status_id": status_item.id, "source_id": source_item.id, "now": now})

        expect(409, lambda: delete_lead_status(status_item.id, req("DELETE", f"/crm/settings/statuses/{status_item.id}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()
        expect(409, lambda: delete_lead_source(source_item.id, req("DELETE", f"/crm/settings/sources/{source_item.id}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()
        expect(409, lambda: delete_lead_status(str(fixture["default_status_id"]), req("DELETE", f"/crm/settings/statuses/{fixture['default_status_id']}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()

        with engine.begin() as connection:
            connection.execute(text("DELETE FROM leads WHERE id=:id AND organization_id=:organization_id"), {"id": lead_id, "organization_id": tenant.organization_id})

        if delete_lead_source(source_item.id, req("DELETE", f"/crm/settings/sources/{source_item.id}"), db, tenant).status_code != 204:  # type: ignore[arg-type]
            raise AssertionError("unused lead source delete did not return 204")
        if delete_lead_status(status_item.id, req("DELETE", f"/crm/settings/statuses/{status_item.id}"), db, tenant).status_code != 204:  # type: ignore[arg-type]
            raise AssertionError("unused lead status delete did not return 204")

        if db.scalar(select(LeadStatus.id).where(LeadStatus.id == status_item.id)) is not None:
            raise AssertionError("deleted lead status still exists")
        if db.scalar(select(LeadSource.id).where(LeadSource.id == source_item.id)) is not None:
            raise AssertionError("deleted lead source still exists")
    finally:
        db.close()

    print("CRM pipeline settings edit/delete verification passed")


if __name__ == "__main__":
    main()
''')

ci = Path(".github/workflows/ci.yml")
ci_text = ci.read_text()
needle = "      - run: uv run python scripts/verify_crm_won_flow.py\n"
step = needle + "      - run: uv run python scripts/verify_crm_settings_management.py\n"
if "verify_crm_settings_management.py" not in ci_text:
    if needle not in ci_text:
        raise SystemExit("CRM CI insertion point not found")
    ci.write_text(ci_text.replace(needle, step, 1))

print("CRM pipeline settings patch applied")
