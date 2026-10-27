import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { loadShippingStatusDashboard } from "@/lib/shipping-status.server";
import { ShippingStatusDashboard } from "@/components/shipping/ShippingStatusDashboard";

export const metadata = { title: "Shipping Status" };

export default async function ShippingStatusPage() {
  const ctx = assertFulfillmentPageAccess(await getTenantContext());

  const initialData = await loadShippingStatusDashboard(
    await createClient(),
    ctx.tenant.id
  );
  return <ShippingStatusDashboard initialData={initialData} />;
}
