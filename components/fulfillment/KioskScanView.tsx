import type { KioskTenant } from "@/lib/kiosk-token";
import { FulfillmentScanPage } from "@/components/fulfillment/FulfillmentScanPage";
import { KioskScanNav } from "@/components/fulfillment/KioskScanNav";
import { normalizeScanButtons } from "@/lib/fulfillment-scan-config";
import { isSmsConfigured } from "@/lib/sms";
import type { BoardColumn, CustomField } from "@/lib/types";

async function FloorScanShell({
  supabase,
  tenantId,
  scanColumnConfig,
  scanApiBase,
}: {
  supabase: KioskTenant["supabase"];
  tenantId: string;
  scanColumnConfig: unknown;
  scanApiBase: string;
}) {
  const [tenantRes, columnsRes, fieldsRes] = await Promise.all([
    supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    supabase
      .from("board_columns")
      .select("id, name, kind, position")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("custom_fields")
      .select("id, name, field_type, options")
      .eq("tenant_id", tenantId),
  ]);

  const tenantName =
    (tenantRes.data as { name: string } | null)?.name ?? "Scan";
  const columns = (columnsRes.data ?? []) as BoardColumn[];
  const customFields = (fieldsRes.data ?? []) as CustomField[];
  const initialButtons = normalizeScanButtons(scanColumnConfig);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <KioskScanNav tenantName={tenantName} kioskToken="" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FulfillmentScanPage
          columns={columns}
          initialButtons={initialButtons}
          tenantName={tenantName}
          customFields={customFields}
          smsConfigured={isSmsConfigured()}
          scanApiBase={scanApiBase}
        />
      </div>
    </div>
  );
}

export async function KioskScanView({ kiosk }: { kiosk: KioskTenant }) {
  return (
    <FloorScanShell
      supabase={kiosk.supabase}
      tenantId={kiosk.tenantId}
      scanColumnConfig={kiosk.scanColumnConfig}
      scanApiBase={`/api/kiosk/${kiosk.token}`}
    />
  );
}

/** Logged-out `/fulfillment/scan` when no kiosk token is configured. */
export async function PublicFloorScanView({
  supabase,
  tenantId,
}: {
  supabase: KioskTenant["supabase"];
  tenantId: string;
}) {
  const { data } = await supabase
    .from("fulfillment_settings")
    .select("scan_column_config")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return (
    <FloorScanShell
      supabase={supabase}
      tenantId={tenantId}
      scanColumnConfig={data?.scan_column_config}
      scanApiBase="/api/public/floor/scan"
    />
  );
}
