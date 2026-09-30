/**
 * Prepress → Production handoff duration from board column-move activity.
 * Used by Time → Reports (Pre-press and Production).
 */

import { classifyStage, stageKey } from "./stage-groups.ts";

export type ReportKind = "designer" | "prepress" | "production";

export interface ColumnMoveEvent {
  orderId: string;
  at: string;
  fromName: string | null;
  toName: string | null;
}

export interface PrepressProductionHandoff {
  orderId: string;
  leftPrepressAt: string;
  enteredProductionAt: string;
  seconds: number;
}

export function parseReportKind(raw: string | null | undefined): ReportKind {
  if (raw === "prepress" || raw === "production") return raw;
  return "designer";
}

/** Same name rule as `isPrepressColumnName` in prepress-queue.ts. */
function isPrepressName(name: string | null | undefined): boolean {
  if (!name) return false;
  const key = stageKey(name);
  return key.includes("prepress") || key.includes("pre press");
}
export function columnNameIsProduction(
  name: string | null | undefined
): boolean {
  if (!name?.trim()) return false;
  return classifyStage({ id: "", name }).group === "production";
}

/** Production Completed / Apparel Prod. Completed — still production group. */
export function columnNameIsProductionCompleted(
  name: string | null | undefined
): boolean {
  if (!name?.trim()) return false;
  const key = stageKey(name);
  return columnNameIsProduction(name) && /\bcompleted\b/.test(key);
}

/** Press / In Production / Hrach / Apparel — not the Completed columns. */
export function columnNameIsActiveProduction(
  name: string | null | undefined
): boolean {
  return columnNameIsProduction(name) && !columnNameIsProductionCompleted(name);
}

function columnNameIsPostproduction(name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  return classifyStage({ id: "", name }).group === "postproduction";
}

export interface ProductionStay {
  orderId: string;
  enteredAt: string;
  leftAt: string;
  seconds: number;
  /** Left to Production Completed (or post-production). */
  completed: boolean;
}

export function moveNamesFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  nameById: Map<string, string>
): { fromName: string | null; toName: string | null } {
  const meta = metadata ?? {};
  const fromName =
    typeof meta.fromName === "string" && meta.fromName.trim()
      ? meta.fromName.trim()
      : null;
  const toName =
    typeof meta.toName === "string" && meta.toName.trim()
      ? meta.toName.trim()
      : null;
  const fromId =
    typeof meta.from === "string" && meta.from.trim() ? meta.from.trim() : null;
  const toId =
    typeof meta.to === "string" && meta.to.trim()
      ? meta.to.trim()
      : typeof meta.movedTo === "string" && meta.movedTo.trim()
        ? meta.movedTo.trim()
        : null;
  return {
    fromName: fromName ?? (fromId ? nameById.get(fromId) ?? null : null),
    toName: toName ?? (toId ? nameById.get(toId) ?? null : null),
  };
}

/**
 * First complete Prepress-leave → Production-enter pair per leave.
 * Same-move Prepress → Production counts (duration 0 if timestamps match).
 */
export function computePrepressToProductionHandoffs(
  events: ColumnMoveEvent[]
): PrepressProductionHandoff[] {
  const byOrder = new Map<string, ColumnMoveEvent[]>();
  for (const e of events) {
    if (!e.orderId) continue;
    const list = byOrder.get(e.orderId) ?? [];
    list.push(e);
    byOrder.set(e.orderId, list);
  }

  const out: PrepressProductionHandoff[] = [];
  for (const [orderId, list] of byOrder) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let leftAt: string | null = null;
    for (const e of list) {
      const fromP = isPrepressName(e.fromName);
      const toP = isPrepressName(e.toName);
      const toProd = columnNameIsProduction(e.toName);
      if (fromP && !toP) leftAt = e.at;
      if (leftAt && toProd) {
        const seconds = Math.max(
          0,
          Math.round((Date.parse(e.at) - Date.parse(leftAt)) / 1000)
        );
        if (Number.isFinite(seconds)) {
          out.push({
            orderId,
            leftPrepressAt: leftAt,
            enteredProductionAt: e.at,
            seconds,
          });
        }
        leftAt = null;
      }
    }
  }
  return out;
}

/**
 * Time spent in active production (In Production, Hrach, Apparel, …).
 * Moves between those columns stay one visit. Ends when the card hits
 * Production Completed / Apparel Prod. Completed or leaves production.
 */
export function computeProductionStays(
  events: ColumnMoveEvent[]
): ProductionStay[] {
  const byOrder = new Map<string, ColumnMoveEvent[]>();
  for (const e of events) {
    if (!e.orderId) continue;
    const list = byOrder.get(e.orderId) ?? [];
    list.push(e);
    byOrder.set(e.orderId, list);
  }

  const out: ProductionStay[] = [];
  for (const [orderId, list] of byOrder) {
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let enteredAt: string | null = null;
    for (const e of list) {
      const fromActive = columnNameIsActiveProduction(e.fromName);
      const toActive = columnNameIsActiveProduction(e.toName);
      const toDone =
        columnNameIsProductionCompleted(e.toName) ||
        columnNameIsPostproduction(e.toName);
      if (!enteredAt && !fromActive && toActive) {
        enteredAt = e.at;
        continue;
      }
      if (enteredAt && fromActive && !toActive) {
        const seconds = Math.max(
          0,
          Math.round((Date.parse(e.at) - Date.parse(enteredAt)) / 1000)
        );
        if (Number.isFinite(seconds)) {
          out.push({
            orderId,
            enteredAt,
            leftAt: e.at,
            seconds,
            completed: toDone,
          });
        }
        enteredAt = null;
      }
    }
    if (enteredAt) {
      out.push({
        orderId,
        enteredAt,
        leftAt: enteredAt,
        seconds: 0,
        completed: false,
      });
    }
  }
  return out;
}

export function medianSeconds(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
