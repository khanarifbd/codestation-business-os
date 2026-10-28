import { notFound } from "next/navigation";
import { CatalogCreate } from "@/components/hr-settings/catalog-create";
export default async function CatalogCreatePage({params}:{params:Promise<{kind:string}>}) {
  const {kind}=await params;
  if(kind!=="leave" && kind!=="shift" && kind!=="holiday")notFound();
  return <CatalogCreate kind={kind}/>;
}
