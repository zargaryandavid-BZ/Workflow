import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { resolveFloorTenant } from "@/lib/kiosk-token";
import { createClient } from "@/lib/supabase/server";

/**
 * Staff fulfillment session, or the no-login floor tenant used by Scan.
 * Logged-in non-admins stay forbidden.
 */
export async function resolveMultiitemAccess(): Promise<
  | { supabase: SupabaseClient; tenantId: string; userId: string | null }
  | { error: NextResponse }
> {
  const ctx = await getTenantContext();
  if (ctx) {
    const auth = requireFulfillmentApi(ctx);
    if ("error" in auth) return auth;
    return {
      supabase: await createClient(),
      tenantId: ctx.tenant.id,
      userId: ctx.userId,
    };
  }

  const floor = await resolveFloorTenant();
  if (!floor) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { supabase: floor.supabase, tenantId: floor.tenantId, userId: null };
}
