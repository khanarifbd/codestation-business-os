import { redirect } from "next/navigation";

export default function LegacyHRSetupPage() {
  redirect("/dashboard/hr/settings");
}
