"use server";

import { getTenantContext } from "@/lib/auth";
import { createOrder, type CreateOrderInput } from "@/lib/order-create";
import { createClient } from "@/lib/supabase/server";

export async function createOrderAction(body: CreateOrderInput) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return { error: "Unauthorized" };
  }

  const supabase = await createClient();
  const result = await createOrder(supabase, ctx, body);

  if ("error" in result) {
    return { error: result.error };
  }

  return {
    order: result.order,
    gdriveFolderUrl: result.gdriveFolderUrl,
    gdriveOpenOnCreate: result.gdriveOpenOnCreate,
    gdriveWarning: result.gdriveWarning,
  };
}
