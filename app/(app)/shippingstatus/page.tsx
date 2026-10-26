import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { ShippingStatusDashboard } from "@/components/shipping/ShippingStatusDashboard";

export const metadata = { title: "Shipping Status" };

export default async function ShippingStatusPage() {
  assertFulfillmentPageAccess(await getTenantContext());
  return <ShippingStatusDashboard />;
}
