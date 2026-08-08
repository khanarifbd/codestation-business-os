"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Loader2 } from "lucide-react";

type Item = { id:string; kind:string; severity:string; title:string; message:string; href:string; due_date:string|null };
export default function NotificationsPage(){
 const [items,setItems]=useState<Item[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null);
 useEffect(()=>{void fetch('/api/workspace/notifications',{cache:'no-store'}).then(async r=>{if(!r.ok) throw new Error('Unable to load notifications'); return r.json();}).then(d=>setItems(d.items??[])).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
 return <main className="min-h-screen bg-neutral-100 p-5 sm:p-8 lg:p-10"><div className="mx-auto max-w-5xl"><div><p className="text-sm text-neutral-500">Smart workspace alerts</p><h1 className="mt-1 text-3xl font-semibold">Notifications</h1><p className="mt-2 text-sm text-neutral-500">Actionable deadlines are generated from live business data, so alerts cannot drift from the source record.</p></div>
 {loading?<div className="mt-10 flex justify-center"><Loader2 className="size-6 animate-spin"/></div>:error?<div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>:<div className="mt-7 space-y-3">{items.map(i=><Link key={i.id} href={i.href} className="flex gap-4 rounded-2xl border bg-white p-5 shadow-sm hover:bg-neutral-50">{i.severity==='critical'?<AlertTriangle className="mt-0.5 size-5 text-red-500"/>:<Bell className="mt-0.5 size-5 text-amber-500"/>}<div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{i.title}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${i.severity==='critical'?'bg-red-50 text-red-700':'bg-amber-50 text-amber-700'}`}>{i.severity}</span></div><p className="mt-1 text-sm text-neutral-500">{i.message}</p></div></Link>)}{!items.length?<div className="rounded-2xl border bg-white p-10 text-center"><CheckCircle2 className="mx-auto size-8 text-emerald-500"/><p className="mt-3 font-semibold">You are all caught up</p><p className="mt-1 text-sm text-neutral-500">No task deadlines need your attention right now.</p></div>:null}</div>}</div></main>;
}
