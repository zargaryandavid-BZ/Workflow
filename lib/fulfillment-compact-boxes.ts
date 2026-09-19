import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sequentialOpenRenumber } from "@/lib/fulfillment-box-numbers";

function numericBox(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

async function restoreOriginalBoxNumbers(
  supabase: SupabaseClient,
  tenantId: string,
  rows: { id: string; original: string }[]
): Promise<void> {
  for (const row of rows) {
    await supabase
      .from("fulfillment_boxes")
      .update({ box_number: `~${row.id}` })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
  }
  for (const row of rows) {
    await supabase
      .from("fulfillment_boxes")
      .update({ box_number: row.original })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
  }
}

/** Keep open packing boxes numbered 1, 2, 3… with no gaps. */
export async function compactOpenFulfillmentBoxes(
  supabase: SupabaseClient,
  tenantId: string
): Promise<void> {
  const { data: all, error } = await supabase
    .from("fulfillment_boxes")
    .select("id, box_number, status")
    .eq("tenant_id", tenantId);
  if (error || !all?.length) return;

  const open = all
    .filter((b) => b.status === "open")
    .slice()
    .sort((a, b) => numericBox(a.box_number, b.box_number));
  if (open.length === 0) return;

  const next = sequentialOpenRenumber(open, []);
  const changes = next.filter(
    (row, i) => Number(row.box_number) !== Number(open[i]?.box_number)
  );
  if (changes.length === 0) return;

  const originals = changes.map((row) => {
    const from = open.find((b) => b.id === row.id);
    return { id: row.id, original: from?.box_number ?? row.box_number };
  });

  for (const row of changes) {
    const { error: tmpErr } = await supabase
      .from("fulfillment_boxes")
      .update({ box_number: `~${row.id}` })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (tmpErr) {
      await restoreOriginalBoxNumbers(supabase, tenantId, originals);
      return;
    }
  }
  for (const row of changes) {
    const { error: finalErr } = await supabase
      .from("fulfillment_boxes")
      .update({ box_number: row.box_number })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (finalErr) {
      await restoreOriginalBoxNumbers(supabase, tenantId, originals);
      return;
    }
  }
}
