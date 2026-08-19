import { parseCrmSnapshot } from "./crm-catalog-v2.ts";
import type {
  CrmSpec,
  CrmSpecOption,
  CrmSnapshot,
  UserSpecOverride,
} from "./types.ts";

export type DisplaySpec = CrmSpec & { overridden: boolean };

export function isConnectedOrder(order: {
  integration_mode?: string | null;
}): boolean {
  return order.integration_mode === "connected";
}

function asOverrideMap(
  raw: unknown
): Record<string, UserSpecOverride> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, UserSpecOverride> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const rec = value as Record<string, unknown>;
    if (typeof rec.display_value !== "string") continue;
    out[key] = { display_value: rec.display_value, value: rec.value };
  }
  return out;
}

/**
 * Merge: user_overrides wins over crm_snapshot for any matching key.
 * Only specs with a non-empty display_value are returned.
 */
export function getDisplaySpecs(order: {
  crm_snapshot?: CrmSnapshot | null;
  user_overrides?: Record<string, UserSpecOverride> | null;
}): DisplaySpec[] {
  const snapshot = parseCrmSnapshot(order.crm_snapshot);
  const lineItem = snapshot?.line_items?.[0];
  if (!lineItem?.specifications?.length) return [];

  const overrides = asOverrideMap(order.user_overrides);

  return lineItem.specifications
    .map((spec) => {
      const override = overrides[spec.key];
      return override
        ? {
            ...spec,
            display_value: override.display_value,
            value: override.value,
            overridden: true,
          }
        : { ...spec, overridden: false };
    })
    .filter(
      (s) => s.display_value != null && String(s.display_value).trim() !== ""
    );
}

export function specLabelFromSnapshot(
  snapshot: CrmSnapshot | null | undefined,
  key: string
): string {
  const specs = parseCrmSnapshot(snapshot)?.line_items?.[0]?.specifications ?? [];
  const match = specs.find((s) => s.key === key);
  return match?.label ?? key.replace(/_/g, " ");
}

export function formatDimensionsDisplay(
  width: unknown,
  height: unknown,
  unit: unknown
): string {
  const w = width == null || width === "" ? "" : String(width);
  const h = height == null || height === "" ? "" : String(height);
  const u = unit == null || unit === "" ? "" : String(unit);
  if (!w && !h) return "";
  const size = w && h ? `${w} × ${h}` : w || h;
  return u ? `${size} ${u}` : size;
}

export function formatBooleanDisplay(value: unknown): string {
  if (value === true || value === "true" || value === "Yes") return "Yes";
  if (value === false || value === "false" || value === "No") return "No";
  return "";
}

export function formatSelectDisplay(
  value: unknown,
  options: CrmSpecOption[]
): string {
  if (value == null || value === "") return "";
  if (typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (typeof rec.label === "string" && rec.label.trim()) return rec.label;
    if (typeof rec.option_id === "string") {
      const match = options.find((o) => o.option_id === rec.option_id);
      if (match) return match.label;
    }
  }
  const id = String(value);
  const match = options.find((o) => o.option_id === id || o.label === id);
  return match?.label ?? id;
}

export function formatMultiSelectDisplay(
  value: unknown,
  options: CrmSpecOption[]
): string {
  const ids: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) ids.push(item.trim());
      else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const id =
          typeof rec.option_id === "string"
            ? rec.option_id
            : typeof rec.label === "string"
              ? rec.label
              : "";
        if (id) ids.push(id);
      }
    }
  } else if (typeof value === "string" && value.trim()) {
    ids.push(
      ...value
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  if (ids.length === 0) return "";
  return ids
    .map((id) => options.find((o) => o.option_id === id || o.label === id)?.label ?? id)
    .join(", ");
}

export type DimensionsValue = {
  width?: number | string | null;
  height?: number | string | null;
  unit?: string | null;
};

export function parseDimensionsValue(value: unknown): DimensionsValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const rec = value as Record<string, unknown>;
  return {
    width: rec.width as number | string | null | undefined,
    height: rec.height as number | string | null | undefined,
    unit: typeof rec.unit === "string" ? rec.unit : null,
  };
}
