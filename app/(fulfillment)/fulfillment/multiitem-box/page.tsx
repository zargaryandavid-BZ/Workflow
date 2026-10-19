import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { MultiitemBoxSlipModal } from "@/components/fulfillment/MultiitemBoxSlipModal";
import { resolveFloorTenant } from "@/lib/kiosk-token";

export default async function Page() {
  const ctx = await getTenantContext();
  if (!ctx) {
    const floor = await resolveFloorTenant();
    if (!floor) notFound();
    return <MultiitemBoxSlipModal open />;
  }

  assertFulfillmentPageAccess(ctx);
  return <MultiitemBoxSlipModal open />;
}
