import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DieOrderClient } from "@/components/die/die-order-client";
import { listDieRequests } from "@/lib/die-requests.server";
import { mapDieManufacturerRow } from "@/lib/die-manufacturers";
import { canViewDieOrder } from "@/lib/permissions";

export const metadata = { title: "Die Order" };

export default async function DieOrderPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (!canViewDieOrder(ctx.role)) redirect("/board");

  const supabase = await createClient();
  const requests = await listDieRequests(supabase, ctx.tenant.id);
  const { data: mfgRows, error: mfgError } = await supabase
    .from("die_manufacturers")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("full_name", { ascending: true });
  const manufacturers =
    mfgError && /die_manufacturers|schema cache|does not exist/i.test(mfgError.message)
      ? []
      : (mfgRows ?? []).map((row) =>
          mapDieManufacturerRow(row as Record<string, unknown>)
        );

  return (
    <div className="board-scroll h-full overflow-y-auto">
      <div className="px-4 py-5">
        <h1 className="text-lg font-semibold text-slate-800">Die Order</h1>
        <p className="mb-5 text-sm text-slate-500">
          Create a die request, email it to the manufacturer, and track price,
          time, and the confirmed due date. The system alarms if that date is
          today, overdue, due soon, or after the required date.
        </p>
        <DieOrderClient requests={requests} manufacturers={manufacturers} />
      </div>
    </div>
  );
}
