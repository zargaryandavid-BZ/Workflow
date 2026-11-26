import { orderDesignerQueue, queueInputFromRow } from "@/lib/designer-queue-rank";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function queuePos(specs: unknown): number {
  const v = (specs as { designer_queue_pos?: unknown } | null)?.designer_queue_pos;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Renumber a designer's remaining Start/In-Progress cards contiguously (0-based
 * `designer_queue_pos`). Call this after a card LEAVES the queue (finished, moved
 * to another column, archived) so the next card in line becomes #1 instead of a
 * gap (…#2, #3 with no #1). Safe no-op when the designer has no queue cards.
 */
export async function resequenceDesignerQueue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  designerId: string | null | undefined
): Promise<number> {
  if (!designerId) return 0;

  const { data: cols } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const queueColumnIds = (cols ?? [])
    .filter((c: { name: string }) => isDesignerQueueColumnName(c.name))
    .map((c: { id: string }) => c.id);
  if (queueColumnIds.length === 0) return 0;

  const { data: rows } = await supabase
    .from("orders")
    .select("id, priority, due_date, specs, last_moved_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("specs->>designer_id", designerId)
    .in("column_id", queueColumnIds)
    .is("removed_at", null)
    .limit(2000);

  // Same order the board shows (rankDesignerQueue): stamped pos = shown #N.
  type Row = {
    id: string;
    priority: string | null;
    due_date: string | null;
    last_moved_at: string | null;
    created_at: string | null;
    specs: Record<string, unknown> | null;
  };
  const rowById = new Map(((rows ?? []) as Row[]).map((r) => [r.id, r]));
  const ordered = orderDesignerQueue(
    ((rows ?? []) as Row[]).map((r) => queueInputFromRow(r))
  ).map((c) => ({
    id: c.id,
    specs: (rowById.get(c.id)?.specs ?? {}) as Record<string, unknown>,
  }));

  const now = new Date().toISOString();
  for (let i = 0; i < ordered.length; i++) {
    if (queuePos(ordered[i].specs) === i) continue; // already correct
    await supabase
      .from("orders")
      .update({
        specs: { ...ordered[i].specs, designer_queue_pos: i },
        updated_at: now,
      })
      .eq("id", ordered[i].id)
      .eq("tenant_id", tenantId);
  }
  return ordered.length;
}

/**
 * Queue slot for a card that is being ASSIGNED to `designerId` (new order,
 * reassignment, auto-assign): the END of that designer's queue, so every
 * designer card has a real #N.
 *
 * Cards with no saved position always rank after saved ones, so first the
 * designer's existing queue is stamped in its CURRENT displayed order
 * (resequence — no reordering, unchanged rows are skipped), then the new card
 * gets the next number. Call BEFORE the card is saved with the new designer.
 * Returns null on any error — assignment must never fail because of the queue.
 */
export async function appendDesignerQueuePos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  designerId: string | null | undefined
): Promise<number | null> {
  if (!designerId) return null;
  try {
    return await resequenceDesignerQueue(supabase, tenantId, designerId);
  } catch (err) {
    console.warn(
      "[designer-queue] append position failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
