import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { MultiitemBoxSlipModal } from "@/components/fulfillment/MultiitemBoxSlipModal";

export default async function Page() {
  assertFulfillmentPageAccess(await getTenantContext());
  return <MultiitemBoxSlipModal open />;
}
