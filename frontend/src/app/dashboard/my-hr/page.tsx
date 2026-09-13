import { redirect } from "next/navigation";

export default function LegacyMyHRPage() {
  redirect("/dashboard/hr/me");
}
