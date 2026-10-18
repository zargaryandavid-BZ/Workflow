import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeWorkingDays } from "@/lib/card-warning-rules";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";
import { logActivity } from "@/lib/automation";
import {
  getDesignerAssignmentSettings,
  pickLeastBusyDesigner,
} from "@/lib/designer-assignment-settings";

/**
 * Hours between two instants that fall on working days only (so a job that sits
 * over a weekend isn't counted as stale). We don't model shop open/close times
 * — a working day counts as 24 active hours, which matches "sitting with the
 * designer more than 24 business hours."
 */
export function businessHoursBetween(
  fromMs: number,
  toMs: number,
  workingDays: number[]
): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  const daySet = new Set(normalizeWorkingDays(workingDays));
  const msPerHour = 1000 * 60 * 60;
  const msPerDay = msPerHour * 24;
  const dayStart = new Date(fromMs);
  dayStart.setHours(0, 0, 0, 0);
  let total = 0;
  for (let d = dayStart.getTime(); d < toMs; d += msPerDay) {
    if (!daySet.has(new Date(d).getDay())) continue;
    const segStart = Math.max(fromMs, d);
    const segEnd = Math.min(toMs, d + msPerDay);
    if (segEnd > segStart) total += (segEnd - segStart) / msPerHour;
  }
  return total;
}

export type StaleReassignResult = {
  tenantId: string;
  checked: number;
  moved: number;
  error?: string;
};

/**
 * Transfer jobs that have sat too long with one pool designer to the next
 * least-busy pool designer. Only runs for tenants that turned it on and set a
 * stale threshold, and only for cards in the Start / In Progress queue whose
 * designer is in the pool. Stamps `specs.designer_assigned_at` on transfer so
 * the new designer gets a fresh window (no ping-pong between runs).
 */
export async function runDesignerStaleReassignForTenant(
  admin: SupabaseClient,
  tenant: { id: string }
): Promise<StaleReassignResult> {
  const tenantId = tenant.id;
  const settings = await getDesignerAssignmentSettings(admin, tenantId);
  if (!settings.enabled || settings.staleHours <= 0 || settings.pool.length < 2) {
    return { tenantId, checked: 0, moved: 0 };
  }

  const { data: cols } = await admin
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const queueColIds = ((cols ?? []) as { id: string; name: string | null }[])
    .filter((c) => isDesignerQueueColumnName(c.name))
    .map((c) => c.id);
  if (queueColIds.length === 0) return { tenantId, checked: 0, moved: 0 };

  const { data: rows } = await admin
    .from("orders")
    .select("id, title, specs, last_moved_at, created_at, column_id")
    .eq("tenant_id", tenantId)
    .in("column_id", queueColIds)
    .is("removed_at", null)
    .limit(5000);

  const pool = new Set(settings.pool);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let checked = 0;
  let moved = 0;

  for (const row of (rows ?? []) as {
    id: string;
    title: string;
    specs: Record<string, unknown> | null;
    last_moved_at: string | null;
    created_at: string | null;
    column_id: string | null;
  }[]) {
    const specs = (row.specs ?? {}) as Record<string, unknown>;
    const designerId =
      typeof specs.designer_id === "string" ? specs.designer_id : "";
    if (!designerId || !pool.has(designerId)) continue;
    checked++;

    const anchorStr =
      (typeof specs.designer_assigned_at === "string" && specs.designer_assigned_at) ||
      row.last_moved_at ||
      row.created_at ||
      null;
    if (!anchorStr) continue;
    const anchorMs = new Date(anchorStr).getTime();
    if (Number.isNaN(anchorMs)) continue;

    const hours = businessHoursBetween(anchorMs, now, settings.workingDays);
    if (hours < settings.staleHours) continue;

    const next = await pickLeastBusyDesigner(admin, tenantId, settings, {
      excludeId: designerId,
    });
    if (!next || next === designerId) continue;

    const { error: upErr } = await admin
      .from("orders")
      .update({
        specs: { ...specs, designer_id: next, designer_assigned_at: nowIso },
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("tenant_id", tenantId);
    if (upErr) continue;

    moved++;
    try {
      await logActivity(admin, {
        tenantId,
        orderId: row.id,
        actor: null,
        action: "designer_reassigned",
        metadata: {
          via: "stale_auto_transfer",
          from_designer: designerId,
          to_designer: next,
          stale_hours: Math.round(hours),
        },
      });
    } catch {
      /* non-critical */
    }
  }

  return { tenantId, checked, moved };
}
