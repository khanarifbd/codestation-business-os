import { ClientAccessSection } from "@/components/client-access-section";
import { ClientServicesSection } from "@/components/client-services-section";

export default async function ClientDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <div className="min-h-screen bg-neutral-100">
    {children}
    <div className="px-4 pb-9 sm:px-7 lg:px-9"><div className="mx-auto max-w-[1500px] space-y-5"><ClientServicesSection clientId={clientId} /><ClientAccessSection clientId={clientId} /></div></div>
  </div>;
}
