import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { AppShell } from "@/components/app-shell/app-shell";
import { normalizeEmergencyBalance } from "@/lib/emergency-balance";

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

  const boardHealthVisible =
    normalizeEmergencyBalance(ctx.tenant.emergency_balance).board_health
      .visible !== false;

  return (
    <AppShell
      role={ctx.role}
      tenants={tenants}
      activeTenantId={ctx.tenant.id}
      email={ctx.email}
      fullName={ctx.fullName}
      boardHealthVisible={boardHealthVisible}
    >
      {children}
    </AppShell>
  );
}
