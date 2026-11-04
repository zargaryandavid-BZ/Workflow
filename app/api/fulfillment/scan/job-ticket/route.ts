import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { jobTicketPdfResponse } from "@/lib/job-ticket-response.server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 180;

/** GET /api/fulfillment/scan/job-ticket?order_id= — Sent history job ticket. */
export async function GET(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  return jobTicketPdfResponse(
    await createClient(),
    auth.ctx.tenant.id,
    new URL(request.url).searchParams.get("order_id")
  );
}
