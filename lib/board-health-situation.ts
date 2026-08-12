/**
 * Structured board-health situation for AI commentary.
 * Pure stats — no LLM calls here.
 */

import {
  daysInCurrentColumn,
  hoursInCurrentColumn,
} from "@/lib/card-warning-rules";
import {
  isBoardHealthCutoffColumn,
  isStuckInColumn,
  type BoardHealthResult,
  type HealthColumn,
} from "@/lib/board-health";
import { businessDateString } from "@/lib/board-order-filters";
import { isDesignerLoadColumn, isInProgressColumn, isStartColumn } from "@/lib/designer-load";
import type { EmergencyBalanceConfig } from "@/lib/emergency-balance";
import { columnsForQuickFilter } from "@/lib/emergency-quick-filters";
import { stageKey } from "@/lib/stage-groups";

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
  /** Avg hours of stuck cards only. */
  avgHoursStuck: number | null;
  /** Avg hours all open cards have been sitting in this column. */
  avgHoursStay: number | null;
}

export interface DesignerLatencyRow {
  designerId: string;
  name: string;
  activeCount: number;
  stuckCount: number;
  lateCount: number;
  avgHoursInColumn: number | null;
}

/** Avg dwell for cards currently sitting in a design stage. */
export interface StageDwellStats {
  openCount: number;
  avgHours: number | null;
  avgWorkingDays: number | null;
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
  /**
   * Average time jobs currently sit in Start / In Progress
   * (from last move into that column → now).
   */
  startColumnDwell: StageDwellStats;
  inProgressColumnDwell: StageDwellStats;
  /** Production floor: Hrach / Apparel / Apparel In Production / In Production. */
  hrachColumnDwell: StageDwellStats;
  apparelColumnDwell: StageDwellStats;
  /** Apparel In Production (+ Apparel Prod.*) — apparel production dwell. */
  apparelProductionColumnDwell: StageDwellStats;
  inProductionColumnDwell: StageDwellStats;
  /**
   * Top 3 column bottlenecks by avg stay time.
   * Excludes Ready to Ship, Boyd, and all later columns.
   */
  bottlenecks: ColumnLatencyRow[];
  /** Designers with the most latency on Start + In Progress cards (active design work). */
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

function isHrachColumn(name: string): boolean {
  return /\bhrach\b/i.test(name.trim());
}

/** Queue-style Apparel column (not yet in production / completed). */
function isApparelQueueColumn(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!/\bapparel\b/.test(n)) return false;
  if (/\b(production|prod\.?|produced|completed|complete)\b/.test(n)) {
    return false;
  }
  return true;
}

/** Apparel In Production — active apparel production time (excludes completed). */
function isApparelProductionColumn(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!/\bapparel\b/.test(n)) return false;
  if (/\b(completed|complete|done|finished)\b/.test(n)) return false;
  return /\b(in[\s-]*production|production|prod\.?)\b/.test(n);
}

/** "In Production" only — excludes Apparel In Production. */
function isInProductionColumn(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (/\bapparel\b/.test(n)) return false;
  return /\bin[\s-]*production\b/.test(n);
}

function stageDwellFrom(
  hours: number[],
  days: number[]
): StageDwellStats {
  return {
    openCount: hours.length,
    avgHours: round1(avg(hours)),
    avgWorkingDays: round1(avg(days)),
  };
}

/**
 * Bottleneck ranking excludes Ready to Ship, Boyd, and everything at/after
 * the Ready-to-Ship cutoff on the board.
 */
function isBottleneckExcludedColumn(col: HealthColumn): boolean {
  if (col.kind === "ready_to_ship" || col.kind === "done") return true;
  const key = stageKey(col.name);
  if (key.includes("ready to ship")) return true;
  if (/\bboyd\b/.test(key)) return true;
  if (key === "shipping" || key.startsWith("shipping ")) return true;
  if (key.includes("shipped")) return true;
  if (key.includes("finished")) return true;
  return false;
}

function columnsEligibleForBottlenecks(
  columns: HealthColumn[]
): HealthColumn[] {
  const cutoffIdx = columns.findIndex(isBoardHealthCutoffColumn);
  const beforeCutoff =
    cutoffIdx >= 0 ? columns.slice(0, cutoffIdx) : columns;
  return beforeCutoff.filter((c) => !isBottleneckExcludedColumn(c));
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
  const designerActiveIds = new Set(
    opts.columns
      .filter((c) => isDesignerLoadColumn(c.name) && pipelineIds.has(c.id))
      .map((c) => c.id)
  );
  const startIds = new Set(
    opts.columns
      .filter((c) => isStartColumn(c.name) && pipelineIds.has(c.id))
      .map((c) => c.id)
  );
  const inProgressIds = new Set(
    opts.columns
      .filter((c) => isInProgressColumn(c.name) && pipelineIds.has(c.id))
      .map((c) => c.id)
  );
  const hrachIds = new Set(
    opts.columns
      .filter((c) => isHrachColumn(c.name) && pipelineIds.has(c.id))
      .map((c) => c.id)
  );
  const apparelIds = new Set(
    opts.columns
      .filter((c) => isApparelQueueColumn(c.name) && pipelineIds.has(c.id))
      .map((c) => c.id)
  );
  const apparelProductionIds = new Set(
    opts.columns
      .filter(
        (c) => isApparelProductionColumn(c.name) && pipelineIds.has(c.id)
      )
      .map((c) => c.id)
  );
  const inProductionIds = new Set(
    opts.columns
      .filter((c) => isInProductionColumn(c.name) && pipelineIds.has(c.id))
      .map((c) => c.id)
  );

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
    allHours: number[];
    stuckHours: number[];
    stuckWorkingDays: number[];
  };
  const byColumn = new Map<string, StuckAcc>();
  for (const c of pipelineCols) {
    byColumn.set(c.id, {
      open: 0,
      allHours: [],
      stuckHours: [],
      stuckWorkingDays: [],
    });
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
  const startHours: number[] = [];
  const startDays: number[] = [];
  const inProgressHours: number[] = [];
  const inProgressDays: number[] = [];
  const hrachHours: number[] = [];
  const hrachDays: number[] = [];
  const apparelHours: number[] = [];
  const apparelDays: number[] = [];
  const apparelProductionHours: number[] = [];
  const apparelProductionDays: number[] = [];
  const inProductionHours: number[] = [];
  const inProductionDays: number[] = [];

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

    if (hoursHere != null && colAcc) {
      colAcc.allHours.push(hoursHere);
    }

    if (hoursHere != null) {
      if (startIds.has(order.column_id)) {
        startHours.push(hoursHere);
        if (workingDaysHere != null) startDays.push(workingDaysHere);
      }
      if (inProgressIds.has(order.column_id)) {
        inProgressHours.push(hoursHere);
        if (workingDaysHere != null) inProgressDays.push(workingDaysHere);
      }
      if (hrachIds.has(order.column_id)) {
        hrachHours.push(hoursHere);
        if (workingDaysHere != null) hrachDays.push(workingDaysHere);
      }
      if (apparelIds.has(order.column_id)) {
        apparelHours.push(hoursHere);
        if (workingDaysHere != null) apparelDays.push(workingDaysHere);
      }
      if (apparelProductionIds.has(order.column_id)) {
        apparelProductionHours.push(hoursHere);
        if (workingDaysHere != null) {
          apparelProductionDays.push(workingDaysHere);
        }
      }
      if (inProductionIds.has(order.column_id)) {
        inProductionHours.push(hoursHere);
        if (workingDaysHere != null) inProductionDays.push(workingDaysHere);
      }
    }

    const did = designerIdFromSpecs(order.specs);
    if (did && byDesigner.has(did) && designerActiveIds.has(order.column_id)) {
      const dAcc = byDesigner.get(did)!;
      dAcc.active += 1;
      if (hoursHere != null) dAcc.hours.push(hoursHere);
      if (stuck) dAcc.stuck += 1;
      if (isLate) dAcc.late += 1;
    }
  }

  const bottleneckEligibleIds = new Set(
    columnsEligibleForBottlenecks(opts.columns).map((c) => c.id)
  );

  const bottlenecks: ColumnLatencyRow[] = [...byColumn.entries()]
    .filter(([columnId]) => bottleneckEligibleIds.has(columnId))
    .map(([columnId, acc]) => ({
      columnId,
      name: colName.get(columnId) ?? columnId,
      openCount: acc.open,
      stuckCount: acc.stuckHours.length,
      avgHoursStuck: round1(avg(acc.stuckHours)),
      avgHoursStay: round1(avg(acc.allHours)),
    }))
    .filter((r) => r.openCount > 0 && r.avgHoursStay != null)
    .sort((a, b) => {
      if ((b.avgHoursStay ?? 0) !== (a.avgHoursStay ?? 0)) {
        return (b.avgHoursStay ?? 0) - (a.avgHoursStay ?? 0);
      }
      if (b.stuckCount !== a.stuckCount) return b.stuckCount - a.stuckCount;
      return b.openCount - a.openCount;
    })
    .slice(0, 3);

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
    startColumnDwell: stageDwellFrom(startHours, startDays),
    inProgressColumnDwell: stageDwellFrom(inProgressHours, inProgressDays),
    hrachColumnDwell: stageDwellFrom(hrachHours, hrachDays),
    apparelColumnDwell: stageDwellFrom(apparelHours, apparelDays),
    apparelProductionColumnDwell: stageDwellFrom(
      apparelProductionHours,
      apparelProductionDays
    ),
    inProductionColumnDwell: stageDwellFrom(
      inProductionHours,
      inProductionDays
    ),
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
    "2) A section titled exactly 'Top 3 bottlenecks:' on its own line, then exactly three numbered items '1. …' '2. …' '3. …' from bottlenecks[] ranked by avgHoursStay (how long jobs stay in that column). Include column name, open count, and avg stay hours. Never mention Ready to Ship, Boyd, Shipping, or later columns — they are already excluded.",
    "3) Design stage dwell: Start avg + In Progress avg (startColumnDwell / inProgressColumnDwell)",
    "4) Production floor dwell: Hrach avg, Apparel queue avg, Apparel production time (apparelProductionColumnDwell), and In Production avg",
    "5) Start-to-finish turnaround vs stuck idle time",
    "6) Designer latency hotspots in Start + In Progress columns only (who / how long)",
    "7) End with a section titled exactly 'Next actions:' on its own line, then exactly three numbered next steps as '1. …' '2. …' '3. …' (no bullet characters in that section).",
    "Keep the whole reply under 280 words. No markdown headings with #. Use short paragraphs and • bullets only outside the Top 3 bottlenecks and Next actions sections.",
    "When citing designerLatency, say they are Start / In Progress column stats.",
    "Always call out Apparel production time from apparelProductionColumnDwell when openCount > 0.",
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
  const start = situation.startColumnDwell;
  if (start.openCount > 0 && start.avgHours != null) {
    lines.push(
      `• Start column: ${start.openCount} jobs, avg ${start.avgHours}h in column` +
        (start.avgWorkingDays != null
          ? ` (~${start.avgWorkingDays} working days).`
          : ".")
    );
  }
  const ip = situation.inProgressColumnDwell;
  if (ip.openCount > 0 && ip.avgHours != null) {
    lines.push(
      `• In Progress: ${ip.openCount} jobs, avg ${ip.avgHours}h in column` +
        (ip.avgWorkingDays != null
          ? ` (~${ip.avgWorkingDays} working days).`
          : ".")
    );
  }
  for (const [label, dwell] of [
    ["Hrach", situation.hrachColumnDwell],
    ["Apparel", situation.apparelColumnDwell],
    ["Apparel production", situation.apparelProductionColumnDwell],
    ["In Production", situation.inProductionColumnDwell],
  ] as const) {
    if (dwell.openCount > 0 && dwell.avgHours != null) {
      lines.push(
        `• ${label}: ${dwell.openCount} jobs, avg ${dwell.avgHours}h in column` +
          (dwell.avgWorkingDays != null
            ? ` (~${dwell.avgWorkingDays} working days).`
            : ".")
      );
    }
  }
  if (situation.avgStartToFinishDays != null) {
    lines.push(
      `• Average start→finish for recent completed jobs: ${situation.avgStartToFinishDays} days (n=${situation.completedSampleSize}).`
    );
  }
  if (situation.bottlenecks.length > 0) {
    lines.push("Top 3 bottlenecks:");
    situation.bottlenecks.forEach((col, i) => {
      lines.push(
        `${i + 1}. ${col.name} — ${col.openCount} jobs, avg stay ${col.avgHoursStay ?? "?"}h` +
          (col.stuckCount > 0 ? ` (${col.stuckCount} stuck).` : ".")
      );
    });
  }
  if (topDes) {
    lines.push(
      `• Highest designer latency (Start / In Progress): ${topDes.name} — ${topDes.stuckCount} stuck / ${topDes.lateCount} late` +
        (topDes.avgHoursInColumn != null
          ? `, avg ${topDes.avgHoursInColumn}h in column.`
          : ".")
    );
  }
  lines.push("Next actions:");
  if (situation.bottlenecks[0]) {
    lines.push(
      `1. Clear the longest-stay bottleneck first: ${situation.bottlenecks[0].name}.`
    );
  } else {
    lines.push(
      "1. Clear the top stuck column first so idle jobs stop blocking throughput."
    );
  }
  lines.push(
    "2. Rebalance designer load on Start / In Progress to cut latency hotspots."
  );
  lines.push(
    "3. Pull late jobs forward before the due-today pile grows."
  );
  return lines.join("\n");
}
