import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { sentHistoryShareResponse } from "@/lib/sent-history-share.server";

/** GET — a read-only share link for this tenant's Sent history. */
export async function GET(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  return sentHistoryShareResponse(request, auth.ctx.tenant.id);
}
