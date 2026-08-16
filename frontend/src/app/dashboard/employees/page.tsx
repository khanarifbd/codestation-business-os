import { redirect } from "next/navigation";

export default function LegacyEmployeesPage() {
  redirect("/dashboard/hr/people");
}
