import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { FulfillmentProductionPage } from "@/components/fulfillment/FulfillmentProductionPage";
import { resolveFloorTenant } from "@/lib/kiosk-token";

export default async function Page() {
  const ctx = await getTenantContext();
  if (!ctx) {
    const floor = await resolveFloorTenant();
    if (!floor) notFound();
    return <FulfillmentProductionPage apiBase="/api/public/floor/production" />;
  }

  assertFulfillmentPageAccess(ctx);
  return <FulfillmentProductionPage />;
}
