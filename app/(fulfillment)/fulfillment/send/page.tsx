import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { FulfillmentSendPage } from "@/components/fulfillment/FulfillmentSendPage";

export default async function Page() {
  assertFulfillmentPageAccess(await getTenantContext());
  return <FulfillmentSendPage />;
}
