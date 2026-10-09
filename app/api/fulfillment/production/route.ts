import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import { listProductionOrders } from "@/lib/fulfillment-production";

export async function GET() {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const supabase = await createClient();
  const result = await listProductionOrders(supabase, ctx.tenant.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(result);
}
