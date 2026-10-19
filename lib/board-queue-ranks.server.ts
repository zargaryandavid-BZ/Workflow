import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";
import { rankDesignerQueue } from "@/lib/designer-queue-rank";
import { isPrepressColumnName, rankPrepressQueue } from "@/lib/prepress-queue";
import type { OrderWithRelations } from "@/lib/types";

function numOrNull(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

type QueueRow = {
  id: string;
  priority: string | null;
  due_date: string | null;
  specs: unknown;
};

/**
 * Attach the live `queue_rank` (#N) to cards from ANY mix of columns — used by
 * the filtered board (designer / owner / source / search), which previously
 * never got a rank, so a designer card with no saved queue position showed no
 * #N badge there. Same ranking as `/api/board/column-orders`:
 *   • Start / In Progress cards with a designer → that designer's 1..N
 *   • Prepress cards → the shared prepress 1..N
 * Mutates `orders`. Two small reads at most; never throws.
 */
export async function attachQueueRanksForOrders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  orders: OrderWithRelations[]
): Promise<void> {
  if (orders.length === 0) return;
  try {
    const { data: cols } = await supabase
      .from("board_columns")
      .select("id, name")
      .eq("tenant_id", tenantId);
    const all = (cols ?? []) as { id: string; name: string }[];
    const queueColumnIds = all
      .filter((c) => isDesignerQueueColumnName(c.name))
      .map((c) => c.id);
    const prepressColumnIds = all
      .filter((c) => isPrepressColumnName(c.name))
      .map((c) => c.id);
    const queueSet = new Set(queueColumnIds);
    const prepressSet = new Set(prepressColumnIds);

    const designerIds = Array.from(
      new Set(
        orders
          .filter((o) => queueSet.has(o.column_id))
          .map((o) => {
            const d = (o.specs as { designer_id?: unknown } | null)?.designer_id;
            return typeof d === "string" && d ? d : null;
          })
          .filter((d): d is string => Boolean(d))
      )
    );
    const needPrepress = orders.some((o) => prepressSet.has(o.column_id));

    const [designerRows, prepressRows] = await Promise.all([
      designerIds.length > 0 && queueColumnIds.length > 0
        ? supabase
            .from("orders")
            .select("id, priority, due_date, specs")
            .eq("tenant_id", tenantId)
            .in("column_id", queueColumnIds)
            .in("specs->>designer_id", designerIds)
            .is("removed_at", null)
            .limit(4000)
            .then((r: { data: QueueRow[] | null }) => r.data ?? [])
        : Promise.resolve([] as QueueRow[]),
      needPrepress && prepressColumnIds.length > 0
        ? supabase
            .from("orders")
            .select("id, priority, due_date, specs")
            .eq("tenant_id", tenantId)
            .in("column_id", prepressColumnIds)
            .is("removed_at", null)
            .limit(4000)
            .then((r: { data: QueueRow[] | null }) => r.data ?? [])
        : Promise.resolve([] as QueueRow[]),
    ]);

    const designerRank = rankDesignerQueue(
      (designerRows as QueueRow[]).map((r) => {
        const specs = (r.specs ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          designerId: String(specs.designer_id ?? ""),
          queuePos: numOrNull(specs.designer_queue_pos),
          priority: r.priority,
          dueDate: r.due_date,
        };
      })
    );
    const prepressRank = rankPrepressQueue(
      (prepressRows as QueueRow[]).map((r) => {
        const specs = (r.specs ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          queuePos: numOrNull(specs.prepress_queue_pos),
          priority: r.priority,
          dueDate: r.due_date,
        };
      })
    );

    for (const o of orders) {
      if (prepressSet.has(o.column_id)) {
        o.queue_rank = prepressRank[o.id] ?? null;
      } else if (queueSet.has(o.column_id)) {
        o.queue_rank = designerRank[o.id] ?? null;
      }
    }
  } catch (err) {
    console.warn(
      "[queue-ranks] attach failed:",
      err instanceof Error ? err.message : err
    );
  }
}
