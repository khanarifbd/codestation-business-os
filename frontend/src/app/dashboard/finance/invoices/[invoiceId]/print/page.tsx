"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Landmark, Loader2, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";

import QRCode from "@/lib/qrcode-svg";

type InvoiceItem = { id:string; description:string; quantity:string|number; unit_price:string|number; discount_percent:string|number; tax_rate:string|number; line_total:string|number };
type InvoiceDetail = { id:string; invoice_number:string; display_status:string; subject:string|null; issue_date:string; due_date:string|null; currency:string; seller_name_snapshot:string; seller_email_snapshot:string|null; seller_address_snapshot:string|null; seller_tax_identifier_snapshot:string|null; client_name_snapshot:string; client_contact_snapshot:string|null; client_email_snapshot:string|null; client_address_snapshot:string|null; client_tax_identifier_snapshot:string|null; subtotal:string|number; discount_total:string|number; tax_total:string|number; total:string|number; amount_paid:string|number; balance_due:string|number; notes:string|null; terms_conditions:string|null; items:InvoiceItem[] };
type PaymentInstructions = {
  invoice_id:string;
  invoice_number:string;
  invoice_status:string;
  invoice_currency:string;
  payment_method:string|null;
  payment_account_id:string|null;
  payment_account_name:string|null;
  payment_provider:string|null;
  payment_account_holder:string|null;
  payment_account_reference:string|null;
  payment_currency:string|null;
  payment_url:string|null;
  payment_instructions:string|null;
  locked:boolean;
};

const PAYMENT_METHOD_LABELS:Record<string,string> = {
  bank_transfer:"Bank transfer",
  payoneer:"Payoneer",
  wise:"Wise",
  stripe:"Stripe",
  paypal:"PayPal",
  card:"Card / payment link",
  cash:"Cash",
  other:"Other",
};

function money(value:string|number,currency:string){return `${currency} ${Number(value||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function pretty(value:string){return value.replaceAll("_"," ").replace(/\b\w/g,(m)=>m.toUpperCase());}
function paymentMethodLabel(value:string|null){return value ? PAYMENT_METHOD_LABELS[value] ?? pretty(value) : "Payment";}
function apiError(payload:unknown,fallback:string){
  if(!payload||typeof payload!=="object")return fallback;
  const detail=(payload as {detail?:unknown}).detail;
  if(typeof detail==="string")return detail;
  if(Array.isArray(detail))return detail.map((item)=>item&&typeof item==="object"&&"msg" in item?String((item as {msg:unknown}).msg):String(item)).join(" · ");
  return fallback;
}

function LocalPaymentQr({value}:{value:string}){
  const containerRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const container=containerRef.current;
    if(!container)return;
    const svg=QRCode({msg:value,dim:152,pad:4,ecl:"M",pal:["#000","#fff"]});
    svg.setAttribute("role","img");
    svg.setAttribute("aria-label","QR code for invoice payment link");
    svg.classList.add("size-[152px]");
    container.replaceChildren(svg);
    return()=>{container.replaceChildren();};
  },[value]);
  return <div ref={containerRef} className="size-[152px]"/>;
}

export default function InvoicePrintPage(){
  const params=useParams<{invoiceId:string}>();
  const router=useRouter();
  const [invoice,setInvoice]=useState<InvoiceDetail|null>(null);
  const [payment,setPayment]=useState<PaymentInstructions|null>(null);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{let active=true;(async()=>{try{
    const [invoiceResponse,paymentResponse]=await Promise.all([
      fetch(`/api/finance/invoices/${params.invoiceId}`,{cache:"no-store"}),
      fetch(`/api/finance/invoices/${params.invoiceId}/payment-instructions`,{cache:"no-store"}),
    ]);
    const [invoicePayload,paymentPayload]=await Promise.all([
      invoiceResponse.json().catch(()=>null),
      paymentResponse.json().catch(()=>null),
    ]);
    if(!invoiceResponse.ok)throw new Error(apiError(invoicePayload,"Unable to load invoice."));
    if(!paymentResponse.ok)throw new Error(apiError(paymentPayload,"Unable to load invoice payment instructions."));
    if(active){setInvoice(invoicePayload as InvoiceDetail);setPayment(paymentPayload as PaymentInstructions);}
  }catch(reason){if(active)setError(reason instanceof Error?reason.message:"Unable to load invoice.");}})();return()=>{active=false};},[params.invoiceId]);

  if(error)return <main className="p-10 print:p-0"><p className="text-red-600">{error}</p></main>;
  if(!invoice||!payment)return <main className="flex min-h-[70vh] items-center justify-center print:min-h-0"><Loader2 className="size-7 animate-spin text-neutral-400"/></main>;

  const hasPaymentInstructions=Boolean(payment.payment_method||payment.payment_account_id||payment.payment_url||payment.payment_instructions);

  return <main className="invoice-print-page min-h-screen bg-neutral-100 p-5 sm:p-8 print:min-h-0 print:bg-white print:p-0">
    <div className="invoice-print-frame mx-auto max-w-[900px]">
      <div className="mb-5 flex items-center justify-between print:hidden">
        <button onClick={()=>router.back()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold"><ArrowLeft className="size-4"/>Back</button>
        <button onClick={()=>window.print()} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white"><Printer className="size-4"/>Print / Save PDF</button>
      </div>

      <article className="invoice-document min-h-[1120px] bg-white p-8 shadow-sm sm:p-12 print:min-h-0 print:p-0 print:shadow-none">
        <header className="invoice-header flex flex-col gap-7 border-b pb-8 sm:flex-row sm:items-start sm:justify-between print:flex-row print:items-start print:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-neutral-400">Invoice</p><h1 className="mt-2 text-3xl font-semibold">{invoice.invoice_number}</h1><p className="mt-2 text-sm text-neutral-500">{invoice.subject||"Invoice"}</p></div>
          <div className="text-left text-sm sm:text-right print:text-right"><p className="font-semibold">{pretty(invoice.display_status)}</p><p className="mt-2 text-neutral-500">Issue date: {invoice.issue_date}</p><p className="mt-1 text-neutral-500">Due date: {invoice.due_date||"—"}</p></div>
        </header>

        <section className="invoice-party-section grid gap-8 border-b py-8 sm:grid-cols-2 print:grid-cols-2">
          <div><p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">From</p><p className="mt-3 font-semibold">{invoice.seller_name_snapshot}</p>{invoice.seller_address_snapshot?<p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.seller_address_snapshot}</p>:null}{invoice.seller_email_snapshot?<p className="mt-1 text-sm text-neutral-600">{invoice.seller_email_snapshot}</p>:null}{invoice.seller_tax_identifier_snapshot?<p className="mt-1 text-sm text-neutral-500">Tax ID: {invoice.seller_tax_identifier_snapshot}</p>:null}</div>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Bill to</p><p className="mt-3 font-semibold">{invoice.client_name_snapshot}</p>{invoice.client_contact_snapshot?<p className="mt-1 text-sm text-neutral-600">{invoice.client_contact_snapshot}</p>:null}{invoice.client_address_snapshot?<p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.client_address_snapshot}</p>:null}{invoice.client_email_snapshot?<p className="mt-1 text-sm text-neutral-600">{invoice.client_email_snapshot}</p>:null}{invoice.client_tax_identifier_snapshot?<p className="mt-1 text-sm text-neutral-500">Tax ID: {invoice.client_tax_identifier_snapshot}</p>:null}</div>
        </section>

        <section className="invoice-items py-8">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-neutral-400"><th className="pb-3">Description</th><th className="pb-3 text-right">Qty</th><th className="pb-3 text-right">Unit price</th><th className="pb-3 text-right">Discount</th><th className="pb-3 text-right">Tax</th><th className="pb-3 text-right">Total</th></tr></thead>
            <tbody className="divide-y">{invoice.items.map((item)=><tr key={item.id}><td className="py-4 pr-4">{item.description}</td><td className="py-4 text-right">{Number(item.quantity)}</td><td className="py-4 text-right">{money(item.unit_price,invoice.currency)}</td><td className="py-4 text-right">{Number(item.discount_percent)}%</td><td className="py-4 text-right">{Number(item.tax_rate)}%</td><td className="py-4 text-right font-medium">{money(item.line_total,invoice.currency)}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="invoice-summary ml-auto max-w-sm border-t pt-5 text-sm"><Row label="Subtotal" value={money(invoice.subtotal,invoice.currency)}/><Row label="Discount" value={money(invoice.discount_total,invoice.currency)}/><Row label="Tax" value={money(invoice.tax_total,invoice.currency)}/><Row label="Invoice total" value={money(invoice.total,invoice.currency)} strong/><Row label="Paid" value={money(invoice.amount_paid,invoice.currency)}/><Row label="Balance due" value={money(invoice.balance_due,invoice.currency)} strong/></section>

        {hasPaymentInstructions?<section className="invoice-payment-section mt-10 grid gap-7 border-t pt-7 sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-2"><Landmark className="size-4"/><p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Payment instructions</p></div>
            <p className="mt-3 font-semibold">{paymentMethodLabel(payment.payment_method)}</p>
            {payment.payment_provider?<PaymentLine label="Provider / bank" value={payment.payment_provider}/>:null}
            {payment.payment_account_name?<PaymentLine label="Destination" value={payment.payment_account_name}/>:null}
            {payment.payment_account_holder?<PaymentLine label="Account holder" value={payment.payment_account_holder}/>:null}
            {payment.payment_account_reference?<PaymentLine label="Account / reference" value={payment.payment_account_reference}/>:null}
            {payment.payment_currency?<PaymentLine label="Receive currency" value={payment.payment_currency}/>:null}
            <PaymentLine label="Payment reference" value={invoice.invoice_number}/>
            {payment.payment_instructions?<p className="mt-4 max-w-xl whitespace-pre-wrap text-sm leading-6 text-neutral-600">{payment.payment_instructions}</p>:null}
            {payment.payment_url?<a href={payment.payment_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex max-w-full items-center gap-2 break-all text-sm font-semibold text-blue-700 underline underline-offset-4">Open payment link <ExternalLink className="size-4 shrink-0"/></a>:null}
          </div>
          {payment.payment_url?<div className="invoice-payment-qr flex flex-col items-center self-start rounded-2xl border bg-white p-3"><LocalPaymentQr value={payment.payment_url}/><p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Scan to pay</p></div>:null}
        </section>:null}

        {invoice.notes?<section className="invoice-notes mt-10 border-t pt-6"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Notes</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.notes}</p></section>:null}
        {invoice.terms_conditions?<section className="invoice-terms mt-6"><p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Terms & Conditions</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">{invoice.terms_conditions}</p></section>:null}
      </article>
    </div>

    <style jsx global>{`
      @media print {
        html, body {
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .invoice-print-page {
          width: 100% !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }
        .invoice-print-frame {
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .invoice-document {
          width: 100% !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
        }
        .invoice-header,
        .invoice-party-section,
        .invoice-summary,
        .invoice-payment-section,
        .invoice-notes {
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .invoice-items thead {
          display: table-header-group;
        }
        .invoice-items tr {
          break-inside: avoid-page;
          page-break-inside: avoid;
        }
        .invoice-summary {
          margin-left: auto !important;
        }
        @page {
          size: A4 portrait;
          margin: 12mm;
        }
      }
    `}</style>
  </main>;
}

function Row({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <div className={`flex justify-between gap-5 py-1.5 ${strong?"mt-2 border-t pt-3 text-base font-semibold":"text-neutral-600"}`}><span>{label}</span><span>{value}</span></div>;}
function PaymentLine({label,value}:{label:string;value:string}){return <div className="mt-2 flex flex-wrap gap-x-2 text-sm"><span className="text-neutral-400">{label}:</span><span className="font-medium text-neutral-700">{value}</span></div>;}
