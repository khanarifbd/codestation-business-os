"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ClientInvitation } from "@/components/client-portal/client-invitation";

function InvitationRoute() {
  const params = useParams<{ token: string }>();
  return <ClientInvitation token={typeof params.token === "string" ? params.token : ""} />;
}
export default function ClientInvitePage() {
  return <Suspense fallback={<p className="p-6" role="status">Loading invitation…</p>}><InvitationRoute /></Suspense>;
}
