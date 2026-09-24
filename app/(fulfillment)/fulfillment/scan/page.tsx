import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { FulfillmentScanPage } from "@/components/fulfillment/FulfillmentScanPage";
import { normalizeScanButtons } from "@/lib/fulfillment-scan-config";
import { isSmsConfigured } from "@/lib/sms";
import type { BoardColumn, CustomField } from "@/lib/types";

export default async function Page() {
  const ctx = assertFulfillmentPageAccess(await getTenantContext());
  const supabase = await createClient();

  const [columnsRes, settingsRes, fieldsRes] = await Promise.all([
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
    supabase
      .from("custom_fields")
      .select("id, name, field_type, options")
      .eq("tenant_id", ctx.tenant.id),
  ]);

  const columns = (columnsRes.data ?? []) as BoardColumn[];
  const scanButtons = normalizeScanButtons(settingsRes.data?.scan_column_config);
  const customFields = (fieldsRes.data ?? []) as CustomField[];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <FulfillmentScanPage
        columns={columns}
        initialButtons={scanButtons}
        tenantName={ctx.tenant.name ?? ""}
        customFields={customFields}
        smsConfigured={isSmsConfigured()}
      />
    </div>
  );
}
