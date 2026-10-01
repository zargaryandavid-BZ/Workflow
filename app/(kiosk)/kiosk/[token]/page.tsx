import { notFound } from "next/navigation";
import { FulfillmentScanPage } from "@/components/fulfillment/FulfillmentScanPage";
import { KioskScanNav } from "@/components/fulfillment/KioskScanNav";
import { normalizeScanButtons } from "@/lib/fulfillment-scan-config";
import { resolveKioskTenant } from "@/lib/kiosk-token";
import { isSmsConfigured } from "@/lib/sms";
import type { BoardColumn, CustomField } from "@/lib/types";

export default async function KioskPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;
  const kiosk = await resolveKioskTenant(rawToken);
  if (!kiosk) notFound();

  const { supabase, tenantId, token } = kiosk;

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
    (tenantRes.data as { name: string } | null)?.name ?? "Kiosk";
  const columns = (columnsRes.data ?? []) as BoardColumn[];
  const customFields = (fieldsRes.data ?? []) as CustomField[];
  const initialButtons = normalizeScanButtons(kiosk.scanColumnConfig);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <KioskScanNav tenantName={tenantName} kioskToken={token} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FulfillmentScanPage
          columns={columns}
          initialButtons={initialButtons}
          tenantName={tenantName}
          customFields={customFields}
          smsConfigured={isSmsConfigured()}
          scanApiBase={`/api/kiosk/${token}`}
        />
      </div>
    </div>
  );
}
