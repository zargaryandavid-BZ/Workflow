/**
 * "X working days after approval" deadline when a card is MOVED past approval.
 *
 * Customer approval (/respond → onApprovalResult) already starts the clock.
 * But staff often skip that step: they drag the card out of Waiting Approval
 * into Prepress / production by hand, or move it straight from Start into
 * production. Before this, those jobs never got a calendar due date.
 *
 * Rule ("left approval"):
 *   - The board's PRODUCTION GATE is the first `done`-kind column
 *     (e.g. "Ready for Prod" / "Done (Ready for Prod)"). Boards without a
 *     `done` column use the position right after their last `approval`-kind
 *     column. Boards with neither never auto-materialize.
 *   - A move counts when the card goes FROM an `approval`-kind column or any
 *     column positioned before the gate (Start, In Progress, Hold, Missing
 *     Info, Customer Replied, Waiting Approval…) INTO a column at or after the
 *     gate that is not itself an approval / exception (Missing Info) column.
 *   - Only for `due_date_mode = after_approval` cards whose calendar due is
 *     still empty and whose status is not already "set". An existing due date
 *     is NEVER replaced.
 *   - Anchor = the time of that move. Same working-day math, label and status
 *     fields as customer approval (materializeAfterApprovalDue).
 *
 * Pure + dependency-free so it runs under the node test runner.
 */

import {
  materializeAfterApprovalDue,
  readOrderDueSpecs,
  type MaterializedDue,
} from "./due-date.ts";

export interface GateColumn {
  id: string;
  position: number | null;
  kind?: string | null;
  name?: string | null;
}

/** Board position where production starts, or null when the board has no gate. */
export function productionGatePosition(columns: GateColumn[]): number | null {
  const positioned = columns.filter(
    (c): c is GateColumn & { position: number } =>
      typeof c.position === "number" && Number.isFinite(c.position)
  );
  const done = positioned.filter((c) => c.kind === "done").map((c) => c.position);
  if (done.length > 0) return Math.min(...done);
  const approval = positioned
    .filter((c) => c.kind === "approval")
    .map((c) => c.position);
  if (approval.length > 0) return Math.max(...approval) + 1;
  return null;
}

/** True when moving fromColumnId → toColumnId takes a card past approval. */
export function isPastApprovalMove(args: {
  fromColumnId: string | null | undefined;
  toColumnId: string | null | undefined;
  columns: GateColumn[];
}): boolean {
  const { fromColumnId, toColumnId, columns } = args;
  if (!fromColumnId || !toColumnId || fromColumnId === toColumnId) return false;
  const gate = productionGatePosition(columns);
  if (gate == null) return false;

  const to = columns.find((c) => c.id === toColumnId);
  const from = columns.find((c) => c.id === fromColumnId);
  if (!to || !from) return false;
  if (typeof to.position !== "number" || typeof from.position !== "number") {
    return false;
  }
  if (to.kind === "approval" || to.kind === "exception") return false;
  if (to.position < gate) return false;

  return from.kind === "approval" || from.position < gate;
}

/**
 * Plan the due-date fill for a move. Returns null when nothing should change
 * (not after_approval, already has a due date / status set, or not a
 * past-approval move).
 */
export function planDueOnMove(args: {
  order: { due_date?: string | null; specs?: unknown };
  fromColumnId: string | null | undefined;
  toColumnId: string | null | undefined;
  columns: GateColumn[];
  movedAt?: Date | string;
}): MaterializedDue | null {
  const { order } = args;
  if (typeof order.due_date === "string" && order.due_date.trim()) return null;
  const due = readOrderDueSpecs(order.specs);
  if (due.due_date_mode !== "after_approval") return null;
  if (due.due_date_status === "set") return null;
  if (
    !isPastApprovalMove({
      fromColumnId: args.fromColumnId,
      toColumnId: args.toColumnId,
      columns: args.columns,
    })
  ) {
    return null;
  }
  return materializeAfterApprovalDue(order.specs, null, args.movedAt ?? new Date());
}
