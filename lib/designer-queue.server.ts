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
): Promise<void> {
  if (!designerId) return;

  const { data: cols } = await supabase
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  const queueColumnIds = (cols ?? [])
    .filter((c: { name: string }) => isDesignerQueueColumnName(c.name))
    .map((c: { id: string }) => c.id);
  if (queueColumnIds.length === 0) return;

  const { data: rows } = await supabase
    .from("orders")
    .select("id, priority, due_date, specs")
    .eq("tenant_id", tenantId)
    .eq("specs->>designer_id", designerId)
    .in("column_id", queueColumnIds)
    .is("removed_at", null)
    .limit(2000);

  const ordered = ((rows ?? []) as Array<{
    id: string;
    priority: string | null;
    due_date: string | null;
    specs: Record<string, unknown> | null;
  }>)
    .map((r) => ({
      id: r.id,
      specs: (r.specs ?? {}) as Record<string, unknown>,
      pos: queuePos(r.specs),
      priority: r.priority ?? "normal",
      due: r.due_date ?? "9999",
    }))
    .sort((a, b) => {
      if (a.pos !== b.pos) return a.pos - b.pos;
      const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
      if (pr !== 0) return pr;
      return a.due.localeCompare(b.due);
    });

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
}
