import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { MultiitemBoxSlipModal } from "@/components/fulfillment/MultiitemBoxSlipModal";
import { FloorDeviceSetup } from "@/components/fulfillment/FloorDeviceSetup";
import { resolveFloorTenant } from "@/lib/kiosk-token";

export default async function Page() {
  const ctx = await getTenantContext();
  if (!ctx) {
    const floor = await resolveFloorTenant();
    if (!floor) return <FloorDeviceSetup />;
    return <MultiitemBoxSlipModal open />;
  }

  assertFulfillmentPageAccess(ctx);
  return <MultiitemBoxSlipModal open />;
}
