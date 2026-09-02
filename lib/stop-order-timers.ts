import { createAdminClient } from "@/lib/supabase/admin";
import { durationSeconds } from "@/lib/time-tracking";
import { columnStopsWorkTimer } from "@/lib/timer-stop-columns";

type OpenTimerRow = {
  id: string;
  user_id: string;
  order_id: string | null;
  started_at: string;
  paused_at: string | null;
  paused_seconds: number;
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
    .select("id, user_id, order_id, started_at, paused_at, paused_seconds")
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
  const { logActivity } = await import("@/lib/automation");

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
    const seconds = durationSeconds(row.started_at, endedAt, Date.now(), {
      pausedAt: row.paused_at,
      pausedSeconds: row.paused_seconds,
    });
    await logActivity(admin, {
      tenantId,
      orderId: row.order_id ?? orderId,
      actor: row.user_id,
      action: "timer_stopped",
      metadata: { seconds },
    }).catch(() => {});
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

/** Approval / missing-info send: clock stops even if the card has not moved yet. */
export async function stopTimersAfterCustomerNotify(opts: {
  tenantId: string;
  orderIds: string[];
}): Promise<void> {
  const ids = [...new Set(opts.orderIds.filter(Boolean))];
  for (const orderId of ids) {
    try {
      await stopOpenTimersForOrder(opts.tenantId, orderId);
    } catch (err) {
      console.error(
        "[stop-order-timers] notify",
        err instanceof Error ? err.message : err
      );
    }
  }
}
