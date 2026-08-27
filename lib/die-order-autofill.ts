import { getDisplaySpecs } from "./connected-specs.ts";
import { parseCrmSnapshot } from "./crm-catalog-v2.ts";
import { isSetSizeKey, parseSetSizeValue } from "./product-spec-options.ts";
import type { CrmSnapshot, CustomField, UserSpecOverride } from "./types.ts";

export type DieOrderAutofill = {
  productName: string;
  width: string;
  height: string;
  depth: string;
};

function fieldByName(
  fields: Pick<CustomField, "id" | "name">[],
  name: string
) {
  const lower = name.toLowerCase();
  return fields.find((f) => f.name.toLowerCase() === lower);
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return "";
  if (typeof value === "string") return value.trim();
  return "";
}

function dimToken(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (parseSetSizeValue(trimmed)) return "";
  const m = trimmed.replace(/["']/g, "").match(/^([\d.]+)/);
  return m ? m[1]! : "";
}

function applyParsed(
  current: DieOrderAutofill,
  parsed: { width: string; height: string; depth?: string } | null
): DieOrderAutofill {
  if (!parsed) return current;
  return {
    ...current,
    width: current.width || parsed.width,
    height: current.height || parsed.height,
    depth: current.depth || parsed.depth || "",
  };
}

function applyObjectDims(
  current: DieOrderAutofill,
  value: unknown
): DieOrderAutofill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return current;
  const rec = value as Record<string, unknown>;
  return {
    ...current,
    width: current.width || dimToken(rec.width),
    height: current.height || dimToken(rec.height),
    depth:
      current.depth ||
      dimToken(rec.depth) ||
      dimToken(rec.length) ||
      dimToken(rec.z),
  };
}

export function dieOrderAutofill(input: {
  customFields: Pick<CustomField, "id" | "name" | "field_type">[];
  fieldValues: Record<string, unknown>;
  crmSnapshot?: unknown;
  userOverrides?: unknown;
}): DieOrderAutofill {
  const fields = input.customFields;
  const valueFor = (name: string) => {
    const field = fieldByName(fields, name);
    return field ? input.fieldValues[field.id] : undefined;
  };

  const productField = valueFor("Product");
  let result: DieOrderAutofill = {
    productName: textValue(productField),
    width: dimToken(valueFor("Width")),
    height: dimToken(valueFor("Height")),
    depth: dimToken(valueFor("Depth")) || dimToken(valueFor("Length")),
  };

  result = applyParsed(result, parseSetSizeValue(String(valueFor("Finished Size") ?? "").trim()));

  const snapshot = parseCrmSnapshot(input.crmSnapshot);
  if (!result.productName) {
    result.productName = snapshot?.line_items?.[0]?.product_name?.trim() ?? "";
  }

  if (!result.width || !result.height || !result.depth) {
    const specs = getDisplaySpecs({
      crm_snapshot: snapshot as CrmSnapshot | null,
      user_overrides: input.userOverrides as Record<
        string,
        UserSpecOverride
      > | null,
    });
    for (const spec of specs) {
      if (!isSetSizeKey(spec.key) && !/dimension/i.test(spec.key + spec.label)) {
        continue;
      }
      result = applyParsed(
        result,
        parseSetSizeValue(String(spec.display_value ?? "").trim())
      );
      result = applyObjectDims(result, spec.value);
    }
  }

  if (result.productName === "Yes" || result.productName === "No") {
    result.productName = "";
  }

  return result;
}
