"use client";
import { useParams } from "next/navigation";
import { EmployeeInvitationWorkspace } from "@/components/identity/employee-invitation";
export default function EmployeeInvitePage() {
  const { token } = useParams<{ token: string }>();
  return <EmployeeInvitationWorkspace token={token} />;
}
