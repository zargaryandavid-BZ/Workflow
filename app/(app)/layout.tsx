import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");

  const tenants = ctx.memberships.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
  }));

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={ctx.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          tenants={tenants}
          activeTenantId={ctx.tenant.id}
          email={ctx.email}
          role={ctx.role}
        />
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
