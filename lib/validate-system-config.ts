import type { SystemConfig } from "@/lib/system-config.types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSystemConfig(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["File is not a valid JSON object"] };
  }

  const cfg = raw as Record<string, unknown>;

  if (cfg.version !== "1.0") {
    errors.push(`Unsupported version: "${cfg.version}" (expected "1.0")`);
  }
  if (!Array.isArray(cfg.columns)) {
    errors.push('Missing or invalid "columns" array');
  }
  if (!Array.isArray(cfg.custom_fields)) {
    errors.push('Missing or invalid "custom_fields" array');
  }
  if (!Array.isArray(cfg.automations)) {
    errors.push('Missing or invalid "automations" array');
  }
  if (!Array.isArray(cfg.integrations)) {
    errors.push('Missing or invalid "integrations" array');
  }
  if (!Array.isArray(cfg.team)) {
    errors.push('Missing or invalid "team" array');
  }

  if (Array.isArray(cfg.columns)) {
    cfg.columns.forEach((col: unknown, i: number) => {
      if (!col || typeof col !== "object") {
        errors.push(`Column[${i}] is not an object`);
        return;
      }
      const c = col as Record<string, unknown>;
      if (!c.name || typeof c.name !== "string") {
        errors.push(`Column[${i}] is missing a name`);
      }
      if (typeof c.position !== "number") {
        errors.push(`Column[${i}] is missing a position number`);
      }
    });
  }

  if (Array.isArray(cfg.custom_fields)) {
    cfg.custom_fields.forEach((field: unknown, i: number) => {
      if (!field || typeof field !== "object") {
        errors.push(`Custom field[${i}] is not an object`);
        return;
      }
      const f = field as Record<string, unknown>;
      if (!f.name || typeof f.name !== "string") {
        errors.push(`Custom field[${i}] is missing a name`);
      }
    });
  }

  if (Array.isArray(cfg.automations)) {
    cfg.automations.forEach((rule: unknown, i: number) => {
      if (!rule || typeof rule !== "object") {
        errors.push(`Automation[${i}] is not an object`);
        return;
      }
      const r = rule as Record<string, unknown>;
      if (!r.trigger || typeof r.trigger !== "string") {
        errors.push(`Automation[${i}] is missing a trigger`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function assertSystemConfig(raw: unknown): SystemConfig {
  const { valid, errors } = validateSystemConfig(raw);
  if (!valid) {
    throw new Error(errors.join("; "));
  }
  return raw as SystemConfig;
}
