import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import AnalyticsDashboard from "@/components/analytics/AnalyticsDashboard";

export default async function AnalyticsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  return (
    <div className="board-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <AnalyticsDashboard tenantId={ctx.tenant.id} />
      </div>
    </div>
  );
}
