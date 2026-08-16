import { HRModuleNav } from "@/components/hr-module-nav";

export default function HRLayout({ children }: { children: React.ReactNode }) {
  return <><HRModuleNav />{children}</>;
}
