import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PICKUP_CODE_SPEC_KEY,
  pickupCodeFromSpecs,
} from "@/lib/pickup-code";

/** Random 8-digit code; first digit is never 0 so it can't lose a digit in a spreadsheet. */
export function generatePickupCode(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

/** True when no order (any shop, picked up or not) has ever used this code. */
async function pickupCodeIsFree(code: string): Promise<boolean> {
  const admin = createAdminClient();
  // Current codes, plus codes kept on past pickups (a re-send after a pickup
  // replaces `pickup_code`, but the used one stays in the confirmation).
  for (const path of [
    `specs->>${PICKUP_CODE_SPEC_KEY}`,
    "specs->pickup_confirmation->>code",
  ]) {
    const { data, error } = await admin
      .from("orders")
      .select("id")
      .eq(path, code)
      .limit(1);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) return false;
  }
  return true;
}

async function uniquePickupCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generatePickupCode();
    if (await pickupCodeIsFree(code)) return code;
  }
  throw new Error("Could not create a unique pickup code. Try again.");
}

function hasPickupConfirmation(specs: Record<string, unknown> | null | undefined) {
  const raw = specs?.pickup_confirmation;
  return Boolean(raw && typeof raw === "object");
}

/**
 * Give every order this message covers the same pickup code. A re-send keeps
 * the code the customer already has (as long as nothing was picked up yet);
 * otherwise a brand-new, never-used code is created.
 *
 * Returns the code plus each order's specs as saved (callers that write specs
 * afterwards must start from these, or the code is overwritten).
 */
export async function assignPickupCode(
  supabase: SupabaseClient,
  tenantId: string,
  orderIds: string[]
): Promise<{ code: string; specsById: Map<string, Record<string, unknown>> }> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const { data, error } = await supabase
    .from("orders")
    .select("id, specs")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as { id: string; specs: unknown }[]).map((row) => ({
    id: row.id,
    specs:
      row.specs && typeof row.specs === "object" && !Array.isArray(row.specs)
        ? (row.specs as Record<string, unknown>)
        : {},
  }));

  const reusable = rows.find(
    (row) => pickupCodeFromSpecs(row.specs) && !hasPickupConfirmation(row.specs)
  );
  const code = reusable ? pickupCodeFromSpecs(reusable.specs)! : await uniquePickupCode();

  const specsById = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (pickupCodeFromSpecs(row.specs) === code) {
      specsById.set(row.id, row.specs);
      continue;
    }
    const specs = { ...row.specs, [PICKUP_CODE_SPEC_KEY]: code };
    const { error: updateError } = await supabase
      .from("orders")
      .update({ specs })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (updateError) throw new Error(updateError.message);
    specsById.set(row.id, specs);
  }
  return { code, specsById };
}
