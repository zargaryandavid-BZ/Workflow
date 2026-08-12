/**
 * Tenant-configurable Emergency / Urgency rules.
 *
 * Design:
 * - Rules are stored per real board column id (not hardcoded names).
 * - Empty conditions for a column = no emergency warning for that column.
 * - Global due-overlay / combo-at-risk thresholds apply when a condition
 *   uses severity "due_overlay" or the combo quick filter.
 */

import { stageKey } from "@/lib/stage-groups";

export type EmergencyConditionSeverity =
  | "amber"
  | "red"
  | "critical"
  | "due_overlay";

/**
 * Structured condition kinds (editable in settings; evaluated on the board).
 * value / value2 are the editable numbers in the IF → THEN formula.
 */
export type EmergencyConditionKind =
  /** IF sitting more than {value} hours → severity */
  | "idle_hours"
  /** IF sitting more than {value} working days → severity */
  | "idle_working_days"
  /** IF due within {value} days → severity (or due_overlay) */
  | "due_within_days"
  /** IF due within {value} days AND sitting more than {value2} hours → severity */
  | "due_within_and_idle_hours"
  /** IF (rush OR due within {value} days) AND sitting more than {value2} hours → severity */
  | "rush_or_due_and_idle_hours"
  /** IF rush AND sitting more than {value} hours → severity */
  | "rush_and_idle_hours"
  /** IF due in exactly {value} days AND sitting more than {value2} hours → severity */
  | "turnaround_days_and_idle_hours"
  /** IF application AND due within {value} days → severity */
  | "application_and_due_within"
  /** IF due today or already late → severity */
  | "turnaround_under_1_day"
  /** IF late OR due within {value} days → severity (or due_overlay) */
  | "late_or_due_within_days";

export interface EmergencyCondition {
  id: string;
  kind: EmergencyConditionKind;
  /** Primary threshold (hours or days depending on kind). */
  value: number;
  /** Second threshold for AND conditions (hours). */
  value2?: number;
  severity: EmergencyConditionSeverity;
}

export interface EmergencyQuickFilterButtonConfig {
  /** When false, the chip is hidden on the board. */
  visible: boolean;
  /**
   * Inclusive end of the column range (from the first board column).
   * null = Board health cutoff (through Ready to Ship).
   */
  through_column_id: string | null;
}

export type EmergencyDueQuickFilterKey =
  | "one_day_left"
  | "due_today"
  | "late";

export type EmergencyQuickFiltersConfig = Record<
  EmergencyDueQuickFilterKey,
  EmergencyQuickFilterButtonConfig
>;

/**
 * Top-bar Board health button + popover.
 * Late / Due today column ranges come from {@link EmergencyBalanceConfig.quick_filters};
 * Warnings from Card Warnings rules; Stuck from per-column idle conditions.
 */
export interface BoardHealthSettingsConfig {
  /** Show the heart button in the app top bar. */
  visible: boolean;
  /**
   * Inclusive end column for open-jobs scope (and Warnings / Stuck).
   * null = Ready to Ship (legacy Board health cutoff).
   */
  through_column_id: string | null;
  show_late: boolean;
  show_due_today: boolean;
  show_warnings: boolean;
  show_stuck: boolean;
}

export interface EmergencyBalanceConfig {
  version: 2;
  combo_at_risk_due_days: number;
  due_overlay_amber_days: number;
  due_overlay_amber_tight_days: number;
  /** If true, any past-due card is at least red even with no column rules. */
  flag_late_always: boolean;
  /**
   * Conditions per board column id.
   * Missing key or empty array = no warning for that column.
   */
  by_column: Record<string, EmergencyCondition[]>;
  /** Visibility + column range for 1 day left / Due today / Late chips. */
  quick_filters: EmergencyQuickFiltersConfig;
  /** Top-bar Board health visibility + which metrics to include. */
  board_health: BoardHealthSettingsConfig;
  /** Show/hide Emergency button and Combo at risk chip on the board. */
  toolbar: EmergencyToolbarConfig;
}

/** Board toolbar: Emergency view button + Combo at risk chip. */
export interface EmergencyToolbarConfig {
  emergency_visible: boolean;
  combo_at_risk_visible: boolean;
}

export const DEFAULT_EMERGENCY_GLOBALS = {
  combo_at_risk_due_days: 2,
  due_overlay_amber_days: 3,
  due_overlay_amber_tight_days: 2,
  flag_late_always: true,
} as const;

export const DEFAULT_QUICK_FILTER_BUTTON: EmergencyQuickFilterButtonConfig = {
  visible: true,
  through_column_id: null,
};

export const EMERGENCY_DUE_QUICK_FILTER_KEYS: EmergencyDueQuickFilterKey[] = [
  "one_day_left",
  "due_today",
  "late",
];

export function defaultQuickFiltersConfig(): EmergencyQuickFiltersConfig {
  return {
    one_day_left: { ...DEFAULT_QUICK_FILTER_BUTTON },
    due_today: { ...DEFAULT_QUICK_FILTER_BUTTON },
    late: { ...DEFAULT_QUICK_FILTER_BUTTON },
  };
}

export const DEFAULT_BOARD_HEALTH_SETTINGS: BoardHealthSettingsConfig = {
  visible: true,
  through_column_id: null,
  show_late: true,
  show_due_today: true,
  show_warnings: true,
  show_stuck: true,
};

export function defaultBoardHealthSettings(): BoardHealthSettingsConfig {
  return { ...DEFAULT_BOARD_HEALTH_SETTINGS };
}

export const DEFAULT_EMERGENCY_TOOLBAR: EmergencyToolbarConfig = {
  emergency_visible: true,
  combo_at_risk_visible: true,
};

export function defaultEmergencyToolbar(): EmergencyToolbarConfig {
  return { ...DEFAULT_EMERGENCY_TOOLBAR };
}

export type ColumnRef = { id: string; name: string };

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createCondition(
  partial: Omit<EmergencyCondition, "id"> & { id?: string }
): EmergencyCondition {
  return {
    id: partial.id ?? newId(),
    kind: partial.kind,
    value: partial.value,
    value2: partial.value2,
    severity: partial.severity,
  };
}

/** Stable id so seeding the same defaults twice stays equal (no false dirty state). */
function stableSuggestedId(
  columnId: string,
  c: Omit<EmergencyCondition, "id">,
  index: number
): string {
  return `${columnId}:${c.kind}:${index}:${c.value}:${c.value2 ?? ""}:${c.severity}`;
}

/** Human labels for the condition kind picker. */
export const CONDITION_KIND_META: Record<
  EmergencyConditionKind,
  {
    label: string;
    needsValue: boolean;
    needsValue2: boolean;
    valueLabel: string;
    value2Label?: string;
    valueUnit: "hours" | "days";
    value2Unit?: "hours" | "days";
  }
> = {
  idle_hours: {
    label: "Sitting more than … hours",
    needsValue: true,
    needsValue2: false,
    valueLabel: "Hours idle",
    valueUnit: "hours",
  },
  idle_working_days: {
    label: "Sitting more than … working days",
    needsValue: true,
    needsValue2: false,
    valueLabel: "Working days idle",
    valueUnit: "days",
  },
  due_within_days: {
    label: "Due within … days",
    needsValue: true,
    needsValue2: false,
    valueLabel: "Days until due",
    valueUnit: "days",
  },
  due_within_and_idle_hours: {
    label: "Due within … days AND sitting more than … hours",
    needsValue: true,
    needsValue2: true,
    valueLabel: "Days until due",
    value2Label: "Hours idle",
    valueUnit: "days",
    value2Unit: "hours",
  },
  rush_or_due_and_idle_hours: {
    label: "(Rush OR due within … days) AND sitting more than … hours",
    needsValue: true,
    needsValue2: true,
    valueLabel: "Days until due",
    value2Label: "Hours idle",
    valueUnit: "days",
    value2Unit: "hours",
  },
  rush_and_idle_hours: {
    label: "Rush AND sitting more than … hours",
    needsValue: true,
    needsValue2: false,
    valueLabel: "Hours idle",
    valueUnit: "hours",
  },
  turnaround_days_and_idle_hours: {
    label: "Due in exactly … days AND sitting more than … hours",
    needsValue: true,
    needsValue2: true,
    valueLabel: "Exact days until due",
    value2Label: "Hours idle",
    valueUnit: "days",
    value2Unit: "hours",
  },
  application_and_due_within: {
    label: "Application job AND due within … days",
    needsValue: true,
    needsValue2: false,
    valueLabel: "Days until due",
    valueUnit: "days",
  },
  turnaround_under_1_day: {
    label: "Due today or already late",
    needsValue: false,
    needsValue2: false,
    valueLabel: "",
    valueUnit: "days",
  },
  late_or_due_within_days: {
    label: "Late OR due within … days",
    needsValue: true,
    needsValue2: false,
    valueLabel: "Days until due",
    valueUnit: "days",
  },
};

/**
 * Suggested starter rules keyed by normalized stage name.
 * Used only to seed defaults for matching board columns.
 */
export function suggestedConditionsForStage(
  columnName: string
): EmergencyCondition[] {
  const key = stageKey(columnName);
  const c = createCondition;

  const map: Record<string, EmergencyCondition[]> = {
    [stageKey("Start")]: [
      c({ kind: "idle_hours", value: 5, severity: "amber" }),
      c({ kind: "idle_hours", value: 20, severity: "critical" }),
      c({ kind: "due_within_days", value: 3, severity: "due_overlay" }),
    ],
    [stageKey("In Progress")]: [
      c({ kind: "idle_hours", value: 5, severity: "amber" }),
      c({ kind: "idle_hours", value: 10, severity: "red" }),
      c({ kind: "idle_hours", value: 20, severity: "critical" }),
      c({ kind: "due_within_days", value: 3, severity: "due_overlay" }),
    ],
    [stageKey("Hold")]: [
      c({ kind: "idle_hours", value: 24, severity: "amber" }),
    ],
    [stageKey("Missing Info / Changes")]: [
      c({ kind: "idle_hours", value: 48, severity: "red" }),
      c({
        kind: "due_within_and_idle_hours",
        value: 2,
        value2: 5,
        severity: "red",
      }),
    ],
    [stageKey("Customer Replied")]: [
      c({ kind: "idle_hours", value: 1, severity: "red" }),
    ],
    [stageKey("Waiting Approval")]: [
      c({ kind: "idle_hours", value: 24, severity: "amber" }),
      c({
        kind: "rush_or_due_and_idle_hours",
        value: 2,
        value2: 2,
        severity: "red",
      }),
    ],
    [stageKey("Done (Ready for Prod)")]: [
      c({ kind: "idle_hours", value: 1, severity: "red" }),
    ],
    [stageKey("Arsen")]: [
      c({ kind: "idle_hours", value: 1, severity: "red" }),
    ],
    [stageKey("Hrach")]: [
      c({ kind: "idle_hours", value: 20, severity: "red" }),
      c({ kind: "rush_and_idle_hours", value: 8, severity: "red" }),
      c({
        kind: "turnaround_days_and_idle_hours",
        value: 1,
        value2: 1,
        severity: "red",
      }),
      c({
        kind: "turnaround_days_and_idle_hours",
        value: 2,
        value2: 3,
        severity: "red",
      }),
    ],
    [stageKey("Apparel")]: [
      c({ kind: "late_or_due_within_days", value: 1, severity: "due_overlay" }),
    ],
    [stageKey("Apparel In Production")]: [
      c({ kind: "late_or_due_within_days", value: 1, severity: "due_overlay" }),
    ],
    [stageKey("In Production")]: [
      c({ kind: "application_and_due_within", value: 2, severity: "red" }),
      c({ kind: "turnaround_under_1_day", value: 0, severity: "red" }),
      c({ kind: "due_within_days", value: 2, severity: "amber" }),
      c({ kind: "idle_working_days", value: 4, severity: "amber" }),
    ],
    [stageKey("Outsource")]: [
      c({ kind: "application_and_due_within", value: 2, severity: "red" }),
      c({ kind: "turnaround_under_1_day", value: 0, severity: "red" }),
      c({ kind: "due_within_days", value: 2, severity: "amber" }),
      c({ kind: "idle_working_days", value: 4, severity: "amber" }),
    ],
    [stageKey("Production Completed")]: [
      c({ kind: "idle_hours", value: 2, severity: "red" }),
    ],
    [stageKey("Apparel Prod. Completed")]: [
      c({ kind: "idle_hours", value: 2, severity: "red" }),
    ],
    [stageKey("Shipped Boyd")]: [
      c({ kind: "idle_hours", value: 2, severity: "red" }),
    ],
    [stageKey("Boyd Received")]: [
      c({ kind: "idle_hours", value: 2, severity: "red" }),
    ],
    [stageKey("In the application")]: [
      c({ kind: "idle_working_days", value: 2, severity: "amber" }),
      c({ kind: "due_within_days", value: 2, severity: "due_overlay" }),
    ],
    [stageKey("(Boyd Only) Ready to Ship")]: [
      c({ kind: "idle_working_days", value: 3, severity: "amber" }),
    ],
    [stageKey("Shipping")]: [
      c({ kind: "idle_hours", value: 3, severity: "red" }),
    ],
  };

  return (map[key] ?? []).map((cond) =>
    createCondition({ ...cond, id: cond.id })
  );
}

/**
 * Suggested rules bound to a concrete board column id (stable ids).
 */
export function suggestedConditionsForColumn(
  column: ColumnRef
): EmergencyCondition[] {
  return suggestedConditionsForStage(column.name).map((cond, index) =>
    createCondition({
      ...cond,
      id: stableSuggestedId(column.id, cond, index),
    })
  );
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

const KINDS = new Set<string>(Object.keys(CONDITION_KIND_META));
const SEVERITIES = new Set<string>([
  "amber",
  "red",
  "critical",
  "due_overlay",
]);

function normalizeCondition(raw: unknown): EmergencyCondition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? "");
  const severity = String(o.severity ?? "");
  if (!KINDS.has(kind) || !SEVERITIES.has(severity)) return null;
  const meta = CONDITION_KIND_META[kind as EmergencyConditionKind];
  const value = clampInt(o.value, 0, 336, meta.needsValue ? 1 : 0);
  const value2 = meta.needsValue2
    ? clampInt(o.value2, 0, 336, 1)
    : undefined;
  return {
    id: typeof o.id === "string" && o.id ? o.id : newId(),
    kind: kind as EmergencyConditionKind,
    value,
    value2,
    severity: severity as EmergencyConditionSeverity,
  };
}

function normalizeByColumn(raw: unknown): Record<string, EmergencyCondition[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, EmergencyCondition[]> = {};
  for (const [columnId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!columnId) continue;
    if (!Array.isArray(list)) {
      out[columnId] = [];
      continue;
    }
    out[columnId] = list
      .map(normalizeCondition)
      .filter((c): c is EmergencyCondition => c != null);
  }
  return out;
}

function normalizeQuickFilterButton(
  raw: unknown,
  columnIds: Set<string>
): EmergencyQuickFilterButtonConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_QUICK_FILTER_BUTTON };
  }
  const o = raw as Record<string, unknown>;
  const through =
    typeof o.through_column_id === "string" && o.through_column_id.trim()
      ? o.through_column_id.trim()
      : null;
  return {
    visible: typeof o.visible === "boolean" ? o.visible : true,
    through_column_id:
      through && (columnIds.size === 0 || columnIds.has(through))
        ? through
        : null,
  };
}

function normalizeQuickFilters(
  raw: unknown,
  columns: ColumnRef[]
): EmergencyQuickFiltersConfig {
  const columnIds = new Set(columns.map((c) => c.id));
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    one_day_left: normalizeQuickFilterButton(src.one_day_left, columnIds),
    due_today: normalizeQuickFilterButton(src.due_today, columnIds),
    late: normalizeQuickFilterButton(src.late, columnIds),
  };
}

function normalizeBoardHealthSettings(
  raw: unknown,
  columns: ColumnRef[]
): BoardHealthSettingsConfig {
  const columnIds = new Set(columns.map((c) => c.id));
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const through =
    typeof src.through_column_id === "string" && src.through_column_id.trim()
      ? src.through_column_id.trim()
      : null;
  return {
    visible: typeof src.visible === "boolean" ? src.visible : true,
    through_column_id:
      through && (columnIds.size === 0 || columnIds.has(through))
        ? through
        : null,
    show_late: typeof src.show_late === "boolean" ? src.show_late : true,
    show_due_today:
      typeof src.show_due_today === "boolean" ? src.show_due_today : true,
    show_warnings:
      typeof src.show_warnings === "boolean" ? src.show_warnings : true,
    show_stuck: typeof src.show_stuck === "boolean" ? src.show_stuck : true,
  };
}

function normalizeEmergencyToolbar(raw: unknown): EmergencyToolbarConfig {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    emergency_visible:
      typeof src.emergency_visible === "boolean"
        ? src.emergency_visible
        : true,
    combo_at_risk_visible:
      typeof src.combo_at_risk_visible === "boolean"
        ? src.combo_at_risk_visible
        : true,
  };
}

/**
 * Build default config for a tenant's columns (suggested rules for known stages).
 * Unknown / new columns start with no conditions (no warning).
 */
export function buildDefaultEmergencyBalance(
  columns: ColumnRef[]
): EmergencyBalanceConfig {
  const by_column: Record<string, EmergencyCondition[]> = {};
  for (const col of columns) {
    const suggested = suggestedConditionsForColumn(col);
    if (suggested.length > 0) by_column[col.id] = suggested;
  }
  return {
    version: 2,
    ...DEFAULT_EMERGENCY_GLOBALS,
    by_column,
    quick_filters: defaultQuickFiltersConfig(),
    board_health: defaultBoardHealthSettings(),
    toolbar: defaultEmergencyToolbar(),
  };
}

/** True when stored JSON is the old flat threshold shape. */
function isLegacyFlatConfig(src: Record<string, unknown>): boolean {
  return (
    src.version !== 2 &&
    (typeof src.start_amber_hours === "number" ||
      typeof src.in_progress_amber_hours === "number" ||
      !("by_column" in src))
  );
}

/**
 * Normalize tenant JSON. When columns are provided, legacy flat configs and
 * empty `{}` are converted into per-column rules using suggested stage defaults.
 */
export function normalizeEmergencyBalance(
  raw: unknown,
  columns: ColumnRef[] = []
): EmergencyBalanceConfig {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const globals = {
    combo_at_risk_due_days: clampInt(
      src.combo_at_risk_due_days,
      1,
      14,
      DEFAULT_EMERGENCY_GLOBALS.combo_at_risk_due_days
    ),
    due_overlay_amber_days: clampInt(
      src.due_overlay_amber_days,
      1,
      30,
      DEFAULT_EMERGENCY_GLOBALS.due_overlay_amber_days
    ),
    due_overlay_amber_tight_days: clampInt(
      src.due_overlay_amber_tight_days,
      1,
      14,
      DEFAULT_EMERGENCY_GLOBALS.due_overlay_amber_tight_days
    ),
    flag_late_always:
      typeof src.flag_late_always === "boolean"
        ? src.flag_late_always
        : DEFAULT_EMERGENCY_GLOBALS.flag_late_always,
  };

  // Empty / missing → seed from column names when we have them.
  const empty =
    Object.keys(src).length === 0 ||
    (src.version !== 2 && !("by_column" in src) && isLegacyFlatConfig(src));

  if (empty && columns.length > 0) {
    return {
      version: 2,
      ...globals,
      by_column: buildDefaultEmergencyBalance(columns).by_column,
      quick_filters: normalizeQuickFilters(src.quick_filters, columns),
      board_health: normalizeBoardHealthSettings(src.board_health, columns),
      toolbar: normalizeEmergencyToolbar(src.toolbar),
    };
  }

  if (src.version === 2 || "by_column" in src) {
    return {
      version: 2,
      ...globals,
      by_column: normalizeByColumn(src.by_column),
      quick_filters: normalizeQuickFilters(src.quick_filters, columns),
      board_health: normalizeBoardHealthSettings(src.board_health, columns),
      toolbar: normalizeEmergencyToolbar(src.toolbar),
    };
  }

  // Legacy flat without columns list: keep globals only (no column rules yet).
  if (columns.length > 0) {
    return {
      version: 2,
      ...globals,
      by_column: buildDefaultEmergencyBalance(columns).by_column,
      quick_filters: normalizeQuickFilters(src.quick_filters, columns),
      board_health: normalizeBoardHealthSettings(src.board_health, columns),
      toolbar: normalizeEmergencyToolbar(src.toolbar),
    };
  }

  return {
    version: 2,
    ...globals,
    by_column: {},
    quick_filters: normalizeQuickFilters(src.quick_filters, columns),
    board_health: normalizeBoardHealthSettings(src.board_health, columns),
    toolbar: normalizeEmergencyToolbar(src.toolbar),
  };
}

/** Apply suggested defaults only to columns that currently have zero conditions. */
export function fillEmptyColumnsWithSuggestions(
  config: EmergencyBalanceConfig,
  columns: ColumnRef[]
): EmergencyBalanceConfig {
  const by_column = { ...config.by_column };
  for (const col of columns) {
    const existing = by_column[col.id];
    if (existing && existing.length > 0) continue;
    const suggested = suggestedConditionsForColumn(col);
    by_column[col.id] = suggested;
  }
  return { ...config, by_column };
}

export function conditionsForColumn(
  config: EmergencyBalanceConfig,
  columnId: string
): EmergencyCondition[] {
  return config.by_column[columnId] ?? [];
}

/** Format a condition as a short IF → THEN label for the UI. */
export function formatConditionSummary(c: EmergencyCondition): string {
  const meta = CONDITION_KIND_META[c.kind];
  const sev =
    c.severity === "due_overlay"
      ? "due-date colors"
      : c.severity === "amber"
        ? "heads-up"
        : c.severity === "red"
          ? "emergency"
          : "critical";
  switch (c.kind) {
    case "idle_hours":
      return `IF sitting > ${c.value}h → ${sev}`;
    case "idle_working_days":
      return `IF sitting > ${c.value} working days → ${sev}`;
    case "due_within_days":
      return `IF due within ${c.value}d → ${sev}`;
    case "due_within_and_idle_hours":
      return `IF due within ${c.value}d AND idle > ${c.value2 ?? 0}h → ${sev}`;
    case "rush_or_due_and_idle_hours":
      return `IF (rush OR due ≤ ${c.value}d) AND idle > ${c.value2 ?? 0}h → ${sev}`;
    case "rush_and_idle_hours":
      return `IF rush AND idle > ${c.value}h → ${sev}`;
    case "turnaround_days_and_idle_hours":
      return `IF due in exactly ${c.value}d AND idle > ${c.value2 ?? 0}h → ${sev}`;
    case "application_and_due_within":
      return `IF application AND due ≤ ${c.value}d → ${sev}`;
    case "turnaround_under_1_day":
      return `IF due today or late → ${sev}`;
    case "late_or_due_within_days":
      return `IF late OR due ≤ ${c.value}d → ${sev}`;
    default:
      return meta.label;
  }
}

/** @deprecated Use buildDefaultEmergencyBalance — kept for import compatibility. */
export const DEFAULT_EMERGENCY_BALANCE: EmergencyBalanceConfig = {
  version: 2,
  ...DEFAULT_EMERGENCY_GLOBALS,
  by_column: {},
  quick_filters: defaultQuickFiltersConfig(),
  board_health: defaultBoardHealthSettings(),
  toolbar: defaultEmergencyToolbar(),
};
