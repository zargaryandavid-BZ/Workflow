import { createAdminClient } from "@/lib/supabase/admin";
import { columnStopsWorkTimer } from "@/lib/timer-stop-columns";

type OpenTimerRow = {
  id: string;
  paused_at: string | null;
};

/**
 * Stop every open (running or paused) timer on an order. Uses the service
 * role so a sales drop into Hold still ends the assigned designer's clock.
 */
export async function stopOpenTimersForOrder(
  tenantId: string,
  orderId: string
): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("time_entries")
    .select("id, paused_at")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId)
    .is("ended_at", null);

  if (error) {
    console.error("[stop-order-timers] list failed:", error.message);
    return 0;
  }

  const rows = (data ?? []) as OpenTimerRow[];
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  let stopped = 0;
  for (const row of rows) {
    const endedAt = row.paused_at ?? now;
    const { error: updateError } = await admin
      .from("time_entries")
      .update({
        ended_at: endedAt,
        paused_at: null,
      })
      .eq("id", row.id)
      .eq("tenant_id", tenantId)
      .is("ended_at", null);
    if (updateError) {
      console.error("[stop-order-timers] stop failed:", updateError.message);
      continue;
    }
    stopped += 1;
  }
  return stopped;
}

export async function maybeStopWorkTimersOnColumnEnter(opts: {
  tenantId: string;
  orderId: string;
  column: { kind?: string | null; name?: string | null };
}): Promise<void> {
  if (!columnStopsWorkTimer(opts.column)) return;
  try {
    await stopOpenTimersForOrder(opts.tenantId, opts.orderId);
  } catch (err) {
    console.error(
      "[stop-order-timers]",
      err instanceof Error ? err.message : err
    );
  }
}
