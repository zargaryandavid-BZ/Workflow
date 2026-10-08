import { getTenantContext } from "@/lib/auth";
import { assertFulfillmentPageAccess } from "@/lib/fulfillment-access";
import { FulfillmentProductionPage } from "@/components/fulfillment/FulfillmentProductionPage";

export default async function Page() {
  assertFulfillmentPageAccess(await getTenantContext());
  return <FulfillmentProductionPage />;
}
