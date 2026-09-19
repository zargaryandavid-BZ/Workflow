import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FulfillmentSettingsForm } from "@/components/fulfillment/FulfillmentSettingsForm";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";

export default async function FulfillmentSettingsPage() {
  const ctx = assertFulfillmentPageAccess(await getTenantContext());

  const supabase = await createClient();

  const [{ data: columns }, { data: settings }] = await Promise.all([
    supabase
      .from("board_columns")
      .select("id, name")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("fulfillment_settings")
      .select("send_column_id, receive_column_id, counted_column_id, missing_column_id")
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-slate-900">Fulfillment</h1>
      <p className="mt-1 text-sm text-slate-500">
        Choose which board columns orders move to when delivered, received,
        counted, or flagged for missing/wrong info.
      </p>
      <div className="mt-6">
        <FulfillmentSettingsForm
          columns={columns ?? []}
          initialSettings={
            settings ?? {
              send_column_id: null,
              receive_column_id: null,
              counted_column_id: null,
              missing_column_id: null,
            }
          }
        />
      </div>
    </div>
  );
}
