import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";

export default async function FulfillmentStandaloneLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");
  return <div className="h-screen overflow-hidden bg-slate-50">{children}</div>;
}
