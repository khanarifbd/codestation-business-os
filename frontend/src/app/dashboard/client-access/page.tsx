import { redirect } from "next/navigation";

export default function ClientAccessPage() {
  redirect("/dashboard/clients");
}
