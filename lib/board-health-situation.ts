/**
 * Structured board-health situation for AI commentary.
 * Pure stats — no LLM calls here.
 */

import {
  daysInCurrentColumn,
  hoursInCurrentColumn,
} from "@/lib/card-warning-rules";
import {
  isStuckInColumn,
  type BoardHealthResult,
  type HealthColumn,
} from "@/lib/board-health";
import { businessDateString } from "@/lib/board-order-filters";
import type { EmergencyBalanceConfig } from "@/lib/emergency-balance";
import { columnsForQuickFilter } from "@/lib/emergency-quick-filters";

export type SituationOrder = {
  id: string;
  column_id: string;
  due_date: string | null;
  last_moved_at: string | null;
  created_at: string;
  updated_at: string;
  specs?: unknown;
};

export type DesignerRef = { id: string; name: string };

export interface ColumnLatencyRow {
  columnId: string;
  name: string;
  openCount: number;
  stuckCount: number;
  avgHoursStuck: number | null;
}

export interface DesignerLatencyRow {
  designerId: string;
  name: string;
  activeCount: number;
  stuckCount: number;
  lateCount: number;
  avgHoursInColumn: number | null;
}

export interface BoardHealthSituation {
  generatedAt: string;
  health: {
    level: number;
    label: string;
    summary: string;
    throughLabel: string;
    counts: BoardHealthResult["counts"];
  };
  /** Completed jobs (done columns): avg calendar days created → updated. */
  avgStartToFinishDays: number | null;
  completedSampleSize: number;
  /** Stuck cards: avg hours sitting in current column. */
  stuckAvgHoursInColumn: number | null;
  stuckAvgWorkingDaysInColumn: number | null;
  /** Columns with the most stuck / idle pressure (bottlenecks). */
  bottlenecks: ColumnLatencyRow[];
  /** Designers with the most latency on open pipeline cards. */
  designerLatency: DesignerLatencyRow[];
}

function designerIdFromSpecs(specs: unknown): string | null {
  if (!specs || typeof specs !== "object") return null;
  const id = (specs as { designer_id?: unknown }).designer_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round1(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Build a situation snapshot used as the LLM prompt payload.
 */
export function buildBoardHealthSituation(opts: {
  health: BoardHealthResult;
  columns: HealthColumn[];
  orders: SituationOrder[];
  designers: DesignerRef[];
  emergencyBalance: EmergencyBalanceConfig;
  warningWorkingDays: number[];
  nowMs?: number;
  /** Lookback for completed start→finish average (ms). Default 90 days. */
  completedLookbackMs?: number;
}): BoardHealthSituation {
  const nowMs = opts.nowMs ?? Date.now();
  const lookback =
    opts.completedLookbackMs ?? 90 * 24 * 60 * 60 * 1000;
  const cfg = opts.emergencyBalance;
  const bh = cfg.board_health;

  const pipelineCols = columnsForQuickFilter(
    opts.columns.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    bh.through_column_id
  );
  const pipelineIds = new Set(pipelineCols.map((c) => c.id));
  const colName = new Map(opts.columns.map((c) => [c.id, c.name]));

  const doneIds = new Set(
    opts.columns
      .filter((c) => c.kind === "done" || /finished|shipped/i.test(c.name))
      .map((c) => c.id)
  );
  // Prefer explicit done kind only when present.
  const doneByKind = opts.columns.filter((c) => c.kind === "done").map((c) => c.id);
  const completedColumnIds = new Set(
    doneByKind.length > 0 ? doneByKind : [...doneIds]
  );

  const completedAges: number[] = [];
  for (const o of opts.orders) {
    if (!completedColumnIds.has(o.column_id)) continue;
    const updated = new Date(o.updated_at).getTime();
    if (!Number.isFinite(updated) || nowMs - updated > lookback) continue;
    const created = new Date(o.created_at).getTime();
    if (!Number.isFinite(created) || updated < created) continue;
    completedAges.push((updated - created) / (1000 * 60 * 60 * 24));
  }

  type StuckAcc = {
    open: number;
    stuckHours: number[];
    stuckWorkingDays: number[];
  };
  const byColumn = new Map<string, StuckAcc>();
  for (const c of pipelineCols) {
    byColumn.set(c.id, { open: 0, stuckHours: [], stuckWorkingDays: [] });
  }

  type DesAcc = {
    active: number;
    stuck: number;
    late: number;
    hours: number[];
  };
  const byDesigner = new Map<string, DesAcc>();
  for (const d of opts.designers) {
    byDesigner.set(d.id, { active: 0, stuck: 0, late: 0, hours: [] });
  }

  const allStuckHours: number[] = [];
  const allStuckDays: number[] = [];

  for (const order of opts.orders) {
    if (!pipelineIds.has(order.column_id)) continue;
    const colAcc = byColumn.get(order.column_id);
    if (colAcc) colAcc.open += 1;

    const hoursHere = hoursInCurrentColumn(order.last_moved_at, nowMs);
    const workingDaysHere = daysInCurrentColumn(
      order.last_moved_at,
      nowMs,
      opts.warningWorkingDays
    );
    const conditions = cfg.by_column[order.column_id] ?? [];
    const stuck = isStuckInColumn(conditions, hoursHere, workingDaysHere);

    const isLate =
      order.due_date != null &&
      order.due_date < businessDateString(new Date(nowMs));

    if (stuck) {
      const h = hoursHere ?? 0;
      const d = workingDaysHere ?? 0;
      allStuckHours.push(h);
      allStuckDays.push(d);
      if (colAcc) {
        colAcc.stuckHours.push(h);
        colAcc.stuckWorkingDays.push(d);
      }
    }

    const did = designerIdFromSpecs(order.specs);
    if (did && byDesigner.has(did)) {
      const dAcc = byDesigner.get(did)!;
      dAcc.active += 1;
      if (hoursHere != null) dAcc.hours.push(hoursHere);
      if (stuck) dAcc.stuck += 1;
      if (isLate) dAcc.late += 1;
    }
  }

  const bottlenecks: ColumnLatencyRow[] = [...byColumn.entries()]
    .map(([columnId, acc]) => ({
      columnId,
      name: colName.get(columnId) ?? columnId,
      openCount: acc.open,
      stuckCount: acc.stuckHours.length,
      avgHoursStuck: round1(avg(acc.stuckHours)),
    }))
    .filter((r) => r.stuckCount > 0 || r.openCount > 0)
    .sort((a, b) => {
      if (b.stuckCount !== a.stuckCount) return b.stuckCount - a.stuckCount;
      return (b.avgHoursStuck ?? 0) - (a.avgHoursStuck ?? 0);
    })
    .slice(0, 8);

  const designerLatency: DesignerLatencyRow[] = opts.designers
    .map((d) => {
      const acc = byDesigner.get(d.id)!;
      return {
        designerId: d.id,
        name: d.name,
        activeCount: acc.active,
        stuckCount: acc.stuck,
        lateCount: acc.late,
        avgHoursInColumn: round1(avg(acc.hours)),
      };
    })
    .filter((r) => r.activeCount > 0 || r.stuckCount > 0 || r.lateCount > 0)
    .sort((a, b) => {
      if (b.stuckCount !== a.stuckCount) return b.stuckCount - a.stuckCount;
      return (b.avgHoursInColumn ?? 0) - (a.avgHoursInColumn ?? 0);
    })
    .slice(0, 10);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    health: {
      level: opts.health.level,
      label: opts.health.label,
      summary: opts.health.summary,
      throughLabel: opts.health.throughLabel,
      counts: opts.health.counts,
    },
    avgStartToFinishDays: round1(avg(completedAges)),
    completedSampleSize: completedAges.length,
    stuckAvgHoursInColumn: round1(avg(allStuckHours)),
    stuckAvgWorkingDaysInColumn: round1(avg(allStuckDays)),
    bottlenecks,
    designerLatency,
  };
}

/** Prompt text for the LLM given a situation snapshot. */
export function buildBoardHealthAnalyzePrompt(
  situation: BoardHealthSituation
): { system: string; user: string } {
  const system = [
    "You are a print-shop production coach for a Kanban board (Print Production Manager).",
    "Write a short, practical briefing for the shop floor manager.",
    "Use only the JSON stats provided — do not invent counts.",
    "Be direct. Prefer concrete bottlenecks and designer latency over generic advice.",
    "Format:",
    "1) One-sentence situation headline",
    "2) Bottlenecks (columns + stuck dwell)",
    "3) Start-to-finish turnaround vs stuck idle time",
    "4) Designer latency hotspots (who / how long)",
    "5) Three concrete next actions",
    "Keep the whole reply under 220 words. No markdown headings with #. Use short paragraphs and bullets with • .",
  ].join(" ");

  const user = [
    "Analyze this board health situation and give feedback:",
    JSON.stringify(situation, null, 2),
  ].join("\n\n");

  return { system, user };
}

/** Fallback when OpenAI is not configured — deterministic text from stats. */
export function formatSituationFallback(
  situation: BoardHealthSituation
): string {
  const c = situation.health.counts;
  const topCol = situation.bottlenecks[0];
  const topDes = situation.designerLatency[0];
  const lines: string[] = [];
  lines.push(
    `Board is ${situation.health.label} (${situation.health.level}/5): ${situation.health.summary}`
  );
  lines.push(
    `• Late ${c.late}, due today ${c.dueToday}, warnings ${c.warnings}, stuck ${c.stuck} (open through ${situation.health.throughLabel}: ${c.open}).`
  );
  if (situation.stuckAvgHoursInColumn != null) {
    lines.push(
      `• Stuck cards sit ~${situation.stuckAvgHoursInColumn}h in column on average` +
        (situation.stuckAvgWorkingDaysInColumn != null
          ? ` (~${situation.stuckAvgWorkingDaysInColumn} working days).`
          : ".")
    );
  }
  if (situation.avgStartToFinishDays != null) {
    lines.push(
      `• Average start→finish for recent completed jobs: ${situation.avgStartToFinishDays} days (n=${situation.completedSampleSize}).`
    );
  }
  if (topCol) {
    lines.push(
      `• Biggest column bottleneck: ${topCol.name} — ${topCol.stuckCount} stuck` +
        (topCol.avgHoursStuck != null
          ? `, avg ${topCol.avgHoursStuck}h idle.`
          : ".")
    );
  }
  if (topDes) {
    lines.push(
      `• Highest designer latency: ${topDes.name} — ${topDes.stuckCount} stuck / ${topDes.lateCount} late` +
        (topDes.avgHoursInColumn != null
          ? `, avg ${topDes.avgHoursInColumn}h in current column.`
          : ".")
    );
  }
  lines.push(
    "• Next: clear the top stuck column first, rebalance designer load on Start/In Progress, and pull late jobs forward before due-today piles up."
  );
  return lines.join("\n");
}
