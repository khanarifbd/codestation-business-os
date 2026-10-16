"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, MapPin } from "lucide-react";

type Office = { id: string; name: string; latitude: number; longitude: number; radius_meters: number; is_active: boolean };
type Employee = { id: string; employee_code: string; name: string };
type Policy = { employee_id: string; office_id: string | null; weekly_modes: string[] };
type AttendanceRequest = {
  id: string; employee_id: string; employee_name: string; employee_code: string;
  request_type: string; requested_mode: string | null; work_date: string; reason: string;
  proposed_check_in_at: string | null; proposed_check_out_at: string | null;
  status: string; review_notes: string | null;
};
type Mode = "office" | "remote" | "field" | "off";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MODES: Mode[] = ["office", "remote", "field", "off"];
const initialModes: Mode[] = ["office", "office", "office", "office", "office", "office", "office"];
const input = "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hr${path}`, {
    ...init, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || "Attendance settings request failed");
  return body as T;
}

export default function AttendanceSettingsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [requests, setRequests] = useState<AttendanceRequest[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [modes, setModes] = useState<Mode[]>([...initialModes]);
  const [officeEditId, setOfficeEditId] = useState("");
  const [officeName, setOfficeName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState(100);
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [meta, officesResult, policyResult, requestResult] = await Promise.all([
      api<{ employees: Employee[] }>("/meta"),
      api<Office[]>("/attendance/offices"),
      api<Policy[]>("/attendance/policies"),
      api<AttendanceRequest[]>("/attendance/requests"),
    ]);
    setEmployees(meta.employees);
    setOffices(officesResult);
    setPolicies(policyResult);
    setRequests(requestResult);
  }, []);

  useEffect(() => {
    let mounted = true;
    void load().catch((reason: unknown) => {
      if (mounted) setError(reason instanceof Error ? reason.message : "Unable to load attendance settings");
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [load]);

  async function mutate(action: () => Promise<void>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      await action();
      await load();
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save attendance settings");
    } finally {
      setBusy(false);
    }
  }

  function chooseEmployee(id: string) {
    setEmployeeId(id);
    const policy = policies.find((item) => item.employee_id === id);
    setOfficeId(policy?.office_id ?? "");
    setModes((policy?.weekly_modes as Mode[] | undefined)?.slice() ?? [...initialModes]);
  }

  function chooseOffice(id: string) {
    setOfficeEditId(id);
    const office = offices.find((item) => item.id === id);
    setOfficeName(office?.name ?? "");
    setLatitude(office ? String(office.latitude) : "");
    setLongitude(office ? String(office.longitude) : "");
    setRadius(office?.radius_meters ?? 100);
    setActive(office?.is_active ?? true);
  }

  function browserLocation() {
    if (!navigator.geolocation) { setError("This browser does not support geolocation."); return; }
    setGpsBusy(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude));
        setLongitude(String(position.coords.longitude));
        setGpsBusy(false);
        setMessage(`Coordinates captured (accuracy ±${Math.round(position.coords.accuracy)} m). Confirm the office position before saving.`);
      },
      (reason) => {
        setGpsBusy(false);
        setError(reason.message || "Unable to access your location");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function saveOffice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(async () => {
      const payload = { name: officeName.trim(), latitude: Number(latitude), longitude: Number(longitude), radius_meters: radius, is_active: active };
      if (!latitude.trim() || !longitude.trim()) throw new Error("Enter accurate latitude and longitude");
      const result = await api<Office>(
        officeEditId ? `/attendance/offices/${encodeURIComponent(officeEditId)}` : "/attendance/offices",
        { method: officeEditId ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      setOfficeEditId(result.id);
      setOfficeName(result.name);
      setLatitude(String(result.latitude));
      setLongitude(String(result.longitude));
      setRadius(result.radius_meters);
      setActive(result.is_active);
    }, officeEditId ? "Office geofence updated." : "Office geofence created.");
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) { setError("Choose an employee"); return; }
    await mutate(async () => {
      await api(`/attendance/policies/${encodeURIComponent(employeeId)}`, {
        method: "PUT", body: JSON.stringify({ office_id: officeId || null, weekly_modes: modes }),
      });
    }, "Employee weekly attendance schedule saved.");
  }

  async function review(id: string, status: "approved" | "rejected") {
    const reviewNotes = window.prompt(`${status === "approved" ? "Approve" : "Reject"} this request? Optional review notes:`, "");
    if (reviewNotes === null) return;
    await mutate(async () => {
      await api(`/attendance/requests/${encodeURIComponent(id)}/review`, {
        method: "POST", body: JSON.stringify({ status, review_notes: reviewNotes.trim() || null }),
      });
    }, `Attendance request ${status}.`);
  }

  if (loading) return <main className="flex min-h-[65vh] items-center justify-center"><Loader2 className="size-7 animate-spin" /></main>;

  return <main className="min-h-screen bg-neutral-100 p-4 sm:p-8">
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <Link href="/dashboard/hr/settings" className="text-sm text-neutral-500 hover:underline">← HR Settings</Link>
        <h1 className="mt-2 text-3xl font-semibold">Attendance setup</h1>
        <p className="mt-2 text-sm text-neutral-500">Office GPS geofences, remote/field workdays and HR-approved attendance exceptions. No office IP or mobile app required.</p>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Office locations</h2>
          <p className="mt-1 text-sm text-neutral-500">Each office has its own GPS geofence. Capture coordinates on-site using a mobile browser or enter a surveyed position.</p>
          <label className="mt-4 block text-sm">Create or edit office<select value={officeEditId} onChange={(event) => chooseOffice(event.target.value)} className={input}><option value="">New office</option>{offices.map((office) => <option key={office.id} value={office.id}>{office.name}{office.is_active ? "" : " (inactive)"}</option>)}</select></label>
          <form onSubmit={saveOffice} className="mt-4 space-y-3">
            <label className="block text-sm">Office name<input className={input} maxLength={120} value={officeName} onChange={(event) => setOfficeName(event.target.value)} required /></label>
            <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Latitude<input className={input} type="number" step="any" min={-90} max={90} value={latitude} onChange={(event) => setLatitude(event.target.value)} required /></label><label className="block text-sm">Longitude<input className={input} type="number" step="any" min={-180} max={180} value={longitude} onChange={(event) => setLongitude(event.target.value)} required /></label></div>
            <button type="button" disabled={gpsBusy || busy} onClick={browserLocation} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50"><MapPin className="size-4" />{gpsBusy ? "Finding location…" : "Use my current location"}</button>
            <label className="block text-sm">Allowed radius (25–1000 meters)<input className={input} type="number" min={25} max={1000} value={radius} onChange={(event) => setRadius(Number(event.target.value))} required /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Active office</label>
            <button disabled={busy} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{officeEditId ? "Update office" : "Add office"}</button>
          </form>
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Employee weekly schedule</h2>
          <p className="mt-1 text-sm text-neutral-500">Select a work mode for each day. Office days require an assigned active office. Set weekly off days explicitly and align them with the employee&apos;s HR shift.</p>
          <form onSubmit={savePolicy} className="mt-4 space-y-4">
            <label className="block text-sm">Employee<select value={employeeId} onChange={(event) => chooseEmployee(event.target.value)} required className={input}><option value="">Choose employee</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employee_code}</option>)}</select></label>
            <label className="block text-sm">Assigned office<select value={officeId} onChange={(event) => setOfficeId(event.target.value)} className={input}><option value="">No assigned office</option>{offices.filter((office) => office.is_active).map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label>
            <div className="space-y-2">{DAYS.map((day, index) => <label key={day} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm"><span className="font-medium">{day}</span><select className="rounded-lg border px-2 py-1.5 capitalize" value={modes[index]} onChange={(event) => setModes((old) => old.map((mode, i) => i === index ? event.target.value as Mode : mode))}>{MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>)}</div>
            <button disabled={busy || !employeeId || (modes.includes("office") && !officeId)} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save schedule</button>
          </form>
        </section>
      </div>
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Remote requests & attendance corrections</h2>
        <p className="mt-1 text-sm text-neutral-500">Employee remote exceptions and missed check-in/out corrections require approval by a different HR manager. Corrections are audited and do not recalculate posted payroll.</p>
        {requests.length ? <div className="mt-4 space-y-3">{requests.map((row) => <div key={row.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.employee_name} · {row.employee_code}</strong><span className="rounded-full bg-neutral-100 px-2 py-1 text-xs capitalize">{row.status}</span></div>
          <p className="mt-1 capitalize">{row.request_type === "mode" ? "Remote work" : "Attendance correction"} · {row.work_date}</p>
          {row.request_type === "correction" && <p className="mt-1 text-xs text-neutral-500">Proposed: {row.proposed_check_in_at ? new Date(row.proposed_check_in_at).toLocaleString() : "—"} → {row.proposed_check_out_at ? new Date(row.proposed_check_out_at).toLocaleString() : "—"}</p>}
          <p className="mt-2 whitespace-pre-wrap text-neutral-600">{row.reason}</p>
          {row.review_notes && <p className="mt-1 text-xs text-neutral-500">Review: {row.review_notes}</p>}
          {row.status === "pending" && <div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={() => void review(row.id, "approved")} className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button type="button" disabled={busy} onClick={() => void review(row.id, "rejected")} className="rounded-lg border px-3 py-2 text-xs disabled:opacity-50">Reject</button></div>}
        </div>)}</div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-400">No attendance requests yet.</p>}
      </section>
    </div>
  </main>;
}
