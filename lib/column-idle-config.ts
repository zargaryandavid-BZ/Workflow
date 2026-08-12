/**
 * Client-safe helpers for column-idle automation config.
 */

export type IdleUnit = "hours" | "days" | "working_days";

export type ColumnIdleConfig = {
  idle_value: number;
  idle_unit: IdleUnit;
};

export function parseColumnIdleConfig(
  raw: Record<string, unknown> | null | undefined
): ColumnIdleConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const unit = raw.idle_unit;
  const idle_unit: IdleUnit =
    unit === "hours" || unit === "days" || unit === "working_days"
      ? unit
      : "days";
  const value = Number(raw.idle_value);
  if (!Number.isFinite(value) || value < 1) return null;
  return {
    idle_value: Math.min(365, Math.round(value)),
    idle_unit,
  };
}

export function formatIdleDuration(cfg: ColumnIdleConfig): string {
  const n = cfg.idle_value;
  if (cfg.idle_unit === "hours") {
    return `${n} hour${n === 1 ? "" : "s"}`;
  }
  if (cfg.idle_unit === "working_days") {
    return `${n} working day${n === 1 ? "" : "s"}`;
  }
  return `${n} day${n === 1 ? "" : "s"}`;
}
