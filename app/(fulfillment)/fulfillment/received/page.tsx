import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { FulfillmentReceivePage } from "@/components/fulfillment/FulfillmentReceivePage";

export default async function Page() {
  assertFulfillmentPageAccess(await getTenantContext());
  return <FulfillmentReceivePage />;
}
