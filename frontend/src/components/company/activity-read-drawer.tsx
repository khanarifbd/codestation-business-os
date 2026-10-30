"use client";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function ActivityReadDrawer({ onClose, children }: { onClose:()=>void; children:ReactNode }) {
 const panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),callback=useRef(onClose);
 useLayoutEffect(()=>{callback.current=onClose;},[onClose]);
 useEffect(()=>{const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;close.current?.focus();
  function key(event:KeyboardEvent){if(event.key==="Escape"){event.preventDefault();callback.current();return;}if(event.key!=="Tab"||!panel.current)return;const controls=Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(node=>!node.hidden&&node.getClientRects().length>0);const first=controls[0],last=controls.at(-1);if(!first){event.preventDefault();panel.current.focus();}else if(event.shiftKey&&(document.activeElement===first||!panel.current.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||!panel.current.contains(document.activeElement))){event.preventDefault();first.focus();}}
  document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);if(previous?.isConnected)previous.focus();};},[]);
 return <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={()=>callback.current()}><aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Activity detail" className="activity-detail-panel h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl" onClick={event=>event.stopPropagation()}><div className="flex justify-end"><button ref={close} type="button" aria-label="Close activity detail" onClick={()=>callback.current()} className="flex size-9 items-center justify-center rounded-lg border"><X aria-hidden="true" className="size-4"/></button></div>{children}</aside></div>;
}
