import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { FulfillmentScanPage } from "@/components/fulfillment/FulfillmentScanPage";
import { normalizeScanButtons } from "@/lib/fulfillment-scan-config";
import type { BoardColumn } from "@/lib/types";

export default async function Page() {
  const ctx = assertFulfillmentPageAccess(await getTenantContext());
  const supabase = await createClient();

  const [columnsRes, settingsRes] = await Promise.all([
    supabase
      .from("board_columns")
      .select("id, name, kind, position")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true }),
    supabase
      .from("fulfillment_settings")
      .select("scan_column_config")
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
  ]);

  const columns = (columnsRes.data ?? []) as BoardColumn[];
  const scanButtons = normalizeScanButtons(settingsRes.data?.scan_column_config);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <FulfillmentScanPage
        columns={columns}
        initialButtons={scanButtons}
      />
    </div>
  );
}
