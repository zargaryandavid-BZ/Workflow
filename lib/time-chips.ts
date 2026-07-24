/** Card time-chip config (system + custom) and stamp helpers. */

export const TIME_CHIP_ICONS = [
  "clock",
  "calendar",
  "timer",
  "truck",
  "check",
  "package",
  "flag",
  "star",
  "alert",
  "mail",
] as const;

export type TimeChipIcon = (typeof TIME_CHIP_ICONS)[number];

export type TimeChipSystemKey =
  | "created"
  | "due"
  | "late"
  | "time_in_column"
  | "priority"
  | "approval"
  | "shipped_entered";

export type TimeChipKind = "system" | "custom";

export interface TimeChip {
  id: string;
  tenant_id: string;
  kind: TimeChipKind;
  system_key: TimeChipSystemKey | null;
  name: string;
  icon: TimeChipIcon | string;
  enabled: boolean;
  visible_all: boolean;
  visible_column_ids: string[];
  stamp_on_column_id: string | null;
  position: number;
  created_at?: string;
  updated_at?: string;
}

export const SYSTEM_TIME_CHIP_DEFAULTS: {
  system_key: TimeChipSystemKey;
  name: string;
  icon: TimeChipIcon;
  position: number;
}[] = [
  { system_key: "created", name: "Created", icon: "clock", position: 0 },
  { system_key: "due", name: "Due date", icon: "calendar", position: 1 },
  { system_key: "late", name: "Late / due status", icon: "alert", position: 2 },
  { system_key: "time_in_column", name: "Time in column", icon: "timer", position: 3 },
  { system_key: "shipped_entered", name: "Entered column date", icon: "truck", position: 4 },
  { system_key: "approval", name: "Approved", icon: "check", position: 5 },
  { system_key: "priority", name: "Priority", icon: "flag", position: 6 },
];

export function isTimeChipIcon(value: string): value is TimeChipIcon {
  return (TIME_CHIP_ICONS as readonly string[]).includes(value);
}

export function timeChipVisibleInColumn(
  chip: TimeChip,
  columnId: string | null | undefined
): boolean {
  if (!chip.enabled) return false;
  if (chip.visible_all) return true;
  if (!columnId) return false;
  return chip.visible_column_ids.includes(columnId);
}

/** Read stamped dates from order.specs.time_chip_stamps */
export function readTimeChipStamps(
  specs: Record<string, unknown> | null | undefined
): Record<string, string> {
  const raw = specs?.time_chip_stamps;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export function withTimeChipStamp(
  specs: Record<string, unknown> | null | undefined,
  chipId: string,
  iso: string
): Record<string, unknown> {
  const prev = { ...(specs ?? {}) };
  const stamps = { ...readTimeChipStamps(prev), [chipId]: iso };
  prev.time_chip_stamps = stamps;
  return prev;
}

/** Chips that should stamp when entering `toColumnId`. */
export function chipsToStampOnEnter(
  chips: TimeChip[],
  toColumnId: string
): TimeChip[] {
  return chips.filter(
    (c) =>
      c.enabled &&
      c.kind === "custom" &&
      c.stamp_on_column_id === toColumnId
  );
}
