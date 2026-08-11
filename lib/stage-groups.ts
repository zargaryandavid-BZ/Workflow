/**
 * Central "Move to" stage-grouping config.
 *
 * The board's stages/columns are tenant-defined rows in the DB, so the
 * "Move to" quick-action menu classifies each column into one of three fixed
 * workflow phases and renders them as labeled, color-tinted sections.
 *
 * DISPLAY-ONLY: grouping + coloring never changes which columns are offered or
 * what happens on click. It only decides which section a column is drawn in.
 *
 * Classification is by a normalized STAGE KEY derived from the column name
 * (robust to case / spacing / punctuation — not a brittle exact-label match),
 * with an optional per-id override map for precision, and a keyword fallback
 * for stages that are not in the canonical lists.
 *
 * This is the single source of truth for the grouping. Any menu that renders a
 * "Move to" stage list (order card, grouped card, table context menu) should
 * import `groupStageColumns` / `STAGE_GROUP_META` from here so the sections and
 * colors stay identical everywhere.
 */

export type StageGroupId = "design" | "production" | "postproduction";

export interface StageGroupMeta {
  id: StageGroupId;
  /** Short section header shown above the group. */
  label: string;
  /** Header text/icon tint. Full literal Tailwind classes (v4 can't see dynamic ones). */
  headerClassName: string;
  /** Tinted background + left color bar for the group body. */
  sectionClassName: string;
  /** Fallback dot ring tint (used when a column has no color of its own). */
  dotClassName: string;
}

/** Canonical top-to-bottom pipeline order: Design → Production → Post-production. */
export const STAGE_GROUP_ORDER: StageGroupId[] = [
  "design",
  "production",
  "postproduction",
];

export const STAGE_GROUP_META: Record<StageGroupId, StageGroupMeta> = {
  design: {
    id: "design",
    label: "Design / Prepress",
    headerClassName: "text-rose-600",
    sectionClassName: "border-l-2 border-rose-300 bg-rose-50/70",
    dotClassName: "border-rose-300",
  },
  production: {
    id: "production",
    label: "Production",
    headerClassName: "text-amber-600",
    sectionClassName: "border-l-2 border-amber-300 bg-amber-50/70",
    dotClassName: "border-amber-300",
  },
  postproduction: {
    id: "postproduction",
    label: "Post-production · Shipping & Fulfillment",
    headerClassName: "text-emerald-600",
    sectionClassName: "border-l-2 border-emerald-300 bg-emerald-50/70",
    dotClassName: "border-emerald-300",
  },
};

/** Normalize a stage name/label into a stable comparison key. */
export function stageKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Canonical membership, keyed by normalized name. Display order is NOT taken
// from these sets — it follows the caller's column order within each group.
const DESIGN_KEYS = new Set(
  [
    "In Progress",
    "Hold",
    "Missing Info / Changes",
    "Customer Replied",
    "Waiting Approval",
    "Done (Ready for Prod)",
  ].map(stageKey)
);

const PRODUCTION_KEYS = new Set(
  [
    "Arsen",
    "Hrach",
    "Apparel",
    "Apparel In Production",
    "In Production",
    "Outsource",
    "Production Completed",
    "Apparel Prod. Completed",
  ].map(stageKey)
);

const POSTPRODUCTION_KEYS = new Set(
  [
    "Shipped Boyd",
    "Boyd Received",
    "In the application",
    "(Boyd Only) Ready to Ship",
    "Shipping",
    "Shipped Customer",
  ].map(stageKey)
);

/**
 * Optional exact per-column-id → group overrides. Empty by default. Populate
 * with real DB column ids when a tenant renames a stage away from its canonical
 * label but it should still live in a specific group. Ids win over name/keyword.
 */
export const STAGE_ID_GROUP_OVERRIDES: Record<string, StageGroupId> = {};

export interface StageClassification {
  group: StageGroupId;
  /**
   * false = fell through to the sensible default (no canonical / keyword match).
   * Callers can surface these for review; they still render, just in the default
   * group.
   */
  matched: boolean;
}

/**
 * Classify a single column into a stage group.
 * Order of precedence: id override → canonical name key → keyword heuristics →
 * sensible default (Production, the operational middle of the pipeline).
 */
export function classifyStage(col: {
  id: string;
  name: string;
}): StageClassification {
  const override = STAGE_ID_GROUP_OVERRIDES[col.id];
  if (override) return { group: override, matched: true };

  const key = stageKey(col.name);

  if (DESIGN_KEYS.has(key)) return { group: "design", matched: true };
  if (PRODUCTION_KEYS.has(key)) return { group: "production", matched: true };
  if (POSTPRODUCTION_KEYS.has(key))
    return { group: "postproduction", matched: true };

  // Keyword fallback for stages outside the canonical lists.
  if (/\bapparel\b/.test(key)) return { group: "production", matched: true };
  if (
    /\b(ship|shipped|shipping|boyd|fulfil|fulfill|fulfillment|deliver|delivery|pickup|application|finished|review)\b/.test(
      key
    )
  )
    return { group: "postproduction", matched: true };
  if (
    /\b(outsource|press|print|printing|cut|cutting|laminat|bindery|prod|production|complete|completed)\b/.test(
      key
    )
  )
    return { group: "production", matched: true };
  if (
    /\b(design|prepress|proof|approval|art|artwork|missing|hold|revision|change|changes|progress|replied|waiting)\b/.test(
      key
    )
  )
    return { group: "design", matched: true };

  // Genuinely unknown custom stage → default to Production and flag for review.
  return { group: "production", matched: false };
}

export interface GroupedStageSection<T> {
  group: StageGroupMeta;
  columns: T[];
}

/**
 * Partition an ordered list of columns into the three stage-group sections.
 * - Preserves the caller's order within each group.
 * - Omits empty sections.
 * - Returns sections in canonical pipeline order.
 */
export function groupStageColumns<T extends { id: string; name: string }>(
  columns: T[]
): GroupedStageSection<T>[] {
  const buckets: Record<StageGroupId, T[]> = {
    design: [],
    production: [],
    postproduction: [],
  };
  for (const col of columns) {
    buckets[classifyStage(col).group].push(col);
  }
  return STAGE_GROUP_ORDER.map((id) => ({
    group: STAGE_GROUP_META[id],
    columns: buckets[id],
  })).filter((section) => section.columns.length > 0);
}
