import { formatOrderDueDisplay } from "./due-date.ts";
import { skuQtySumFromSpecs } from "./skus.ts";
import { webhookPrintQty } from "./webhook-crm-parse.ts";
import {
  dieOrderNumberMatchRank,
  orderMatchesNumberSearch,
} from "./order-number-tokens.ts";

export function sanitizeScanLookupToken(value: string): string {
  return value.replace(/[%_,()]/g, "").trim().slice(0, 32);
}

export function pickScannedOrder<
  T extends { title: string; specs?: Record<string, unknown> | null },
>(orders: T[], query: string): T | null {
  const q = query.trim();
  if (!q || orders.length === 0) return null;
  const ranked = orders
    .filter((order) => orderMatchesNumberSearch(order, q))
    .sort(
      (a, b) =>
        dieOrderNumberMatchRank(a, q) - dieOrderNumberMatchRank(b, q)
    );
  return ranked[0] ?? null;
}

/** Each field has a display label and an ordered list of key aliases to try (all lowercased). */
const SCAN_SPEC_FIELDS: { label: string; keys: string[] }[] = [
  { label: "Line Item", keys: ["webhook_item_title", "webhook_order_title", "line_item_name", "line item name", "item_name", "item name", "line_item", "line item", "job_name", "job name"] },
  { label: "Category", keys: ["category"] },
  { label: "Product", keys: ["product"] },
  { label: "Materials", keys: ["materials", "material", "stock", "paper stock"] },
  { label: "Special effects", keys: ["special effects", "special_effects"] },
  { label: "Finishing", keys: ["finishing", "finish", "lamination"] },
  { label: "Sides", keys: ["sides"] },
  { label: "Roll Direction", keys: ["roll direction", "roll_direction", "position"] },
  { label: "Color", keys: ["color"] },
  { label: "Color Mode", keys: ["color mode", "color_mode"] },
  { label: "Die", keys: ["die", "die type", "die_type"] },
  { label: "Width", keys: ["width"] },
  { label: "Height", keys: ["height"] },
  { label: "Depth", keys: ["depth", "length"] },
  { label: "Finished Size", keys: ["finished size", "finished_size", "size", "set_size"] },
  { label: "Application", keys: ["application"] },
  { label: "Die Cut", keys: ["die cut", "die_cut"] },
  { label: "Perforation", keys: ["perforation"] },
  { label: "Zipper", keys: ["zipper"] },
  { label: "Corners", keys: ["corners", "corner"] },
  { label: "Gusset size", keys: ["gusset size", "gusset_size", "gusset"] },
  { label: "Options", keys: ["product_options", "options"] },
];

const SKIP_LEFTOVER_KEYS = new Set(
  [
    "quantity",
    "qty",
    "order qty",
    "order_qty",
    "customer name",
    "customer contact",
    "artwork (gdrive link)",
    "artwork",
    "designer",
    "designer_id",
    "designer_name",
    "owner_name",
    "request_owner_name",
    "account_manager",
    "unit price",
    "unit price ($)",
    "billing",
    "skus",
    "card_image",
    "card_images",
    "card_pdf_rev",
    "due_date",
    "due_date_label",
    "locked",
    "reprint",
    "is_key_account",
    "need_a_design",
    "design_fee",
    "spec_display",
    "spec_selections",
    "catalog_source",
    "connected_specs",
    "webhook_order_number",
    "webhook_source",
  ].map((k) => k.toLowerCase())
);

function looksInternalSpecKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (SKIP_LEFTOVER_KEYS.has(k)) return true;
  if (k.startsWith("webhook_")) return true;
  if (k.endsWith("_id") || k.endsWith("_url") || k.endsWith("_folder")) return true;
  return false;
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === "" || v === false;
}

function displayValue(raw: unknown): string | null {
  if (isEmptyValue(raw)) return null;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return displayValue(JSON.parse(trimmed));
      } catch {
        /* keep the raw string */
      }
    }
    return trimmed;
  }
  if (Array.isArray(raw)) {
    const parts = raw.map(displayValue).filter((s): s is string => Boolean(s));
    return parts.length ? parts.join(", ") : null;
  }
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    return displayValue(
      rec.display_value ?? rec.label ?? rec.name ?? rec.value
    );
  }
  return String(raw).trim() || null;
}

/** Case-insensitive lookup on specs and/or custom-field name maps. */
export function specValueByNames(
  bag: Record<string, unknown> | null | undefined,
  names: string[]
): string | null {
  if (!bag) return null;
  const byLower = new Map(
    Object.entries(bag).map(([k, v]) => [k.toLowerCase(), v])
  );
  for (const name of names) {
    const shown = displayValue(byLower.get(name.toLowerCase()));
    if (shown) return shown;
  }
  return null;
}

export function mergeScanNamedValues(
  specs: Record<string, unknown> | null | undefined,
  fieldValuesByName: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    if (!isEmptyValue(v)) out[k.toLowerCase()] = v;
  }
  for (const [k, v] of Object.entries(fieldValuesByName)) {
    if (!isEmptyValue(v)) out[k.toLowerCase()] = v;
  }
  return out;
}

function formatDueYmd(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type ScanSpecLine = { label: string; value: string };

function parseSpecDisplayRows(raw: unknown): ScanSpecLine[] {
  if (!Array.isArray(raw)) return [];
  const rows: ScanSpecLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const value = displayValue(rec.value);
    if (!value) continue;
    const labelRaw = typeof rec.label === "string" ? rec.label.trim() : "";
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    const label =
      labelRaw ||
      (key
        ? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : "Spec");
    if (looksInternalSpecKey(label) || looksInternalSpecKey(key)) continue;
    rows.push({ label, value });
  }
  return rows;
}

function labelKey(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function scanQtyFromSpecs(
  specs: Record<string, unknown> | null | undefined,
  named: Record<string, unknown>
): number | null {
  const fromName =
    named["order qty"] ?? named.quantity ?? named.qty ?? named["order_qty"];
  const n = typeof fromName === "number" ? fromName : Number(fromName);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);

  const rec = (specs ?? {}) as {
    order_qty?: unknown;
    quantity?: unknown;
    Quantity?: unknown;
  };
  const print = webhookPrintQty(
    {
      order_qty: rec.order_qty,
      quantity: rec.quantity ?? rec.Quantity,
    },
    []
  );
  if (print != null && print > 0) return Math.floor(print);

  const sku = skuQtySumFromSpecs(specs);
  return sku > 0 ? sku : null;
}

export function buildScanCardDisplay(args: {
  specs: Record<string, unknown> | null | undefined;
  dueDate: string | null | undefined;
  fieldValuesByName?: Record<string, unknown>;
}): {
  qty: number | null;
  specLines: ScanSpecLine[];
  dueDisplay: string;
} {
  const named = mergeScanNamedValues(args.specs, args.fieldValuesByName ?? {});
  const specLines: ScanSpecLine[] = [];
  const used = new Set<string>();

  const pushLine = (label: string, value: string) => {
    const key = labelKey(label);
    if (!key || used.has(key)) return;
    if (/^(none|n\/a)$/i.test(value.trim())) return;
    used.add(key);
    specLines.push({ label, value });
  };

  const qty = scanQtyFromSpecs(args.specs, named);
  if (qty != null) pushLine("Qty", String(qty));

  for (const field of SCAN_SPEC_FIELDS) {
    const value = specValueByNames(named, field.keys);
    if (!value) continue;
    if (labelKey(field.label) === "die cut" && specValueByNames(named, ["die"])) {
      continue;
    }
    pushLine(field.label, value);
  }

  for (const [name, raw] of Object.entries(args.fieldValuesByName ?? {})) {
    if (looksInternalSpecKey(name)) continue;
    const value = displayValue(raw);
    if (!value) continue;
    pushLine(name, value);
  }

  for (const row of parseSpecDisplayRows(args.specs?.spec_display)) {
    pushLine(row.label, row.value);
  }
  return {
    qty,
    specLines,
    dueDisplay: formatOrderDueDisplay(args.dueDate, args.specs, formatDueYmd),
  };
}

export function scanOwnerNameFromSpecs(
  specs: Record<string, unknown> | null | undefined
): string | null {
  return specValueByNames(specs, [
    "owner_name",
    "request_owner_name",
    "account_manager",
  ]);
}

export function scanDesignerNameFromSpecs(
  specs: Record<string, unknown> | null | undefined
): string | null {
  return specValueByNames(specs, ["designer_name"]);
}

export function nestedCustomer(
  raw: unknown
): {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
} | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const c = row as {
    id?: unknown;
    name?: unknown;
    email?: unknown;
    phone?: unknown;
  };
  if (typeof c.id !== "string") return null;
  return {
    id: c.id,
    name: typeof c.name === "string" ? c.name : null,
    email: typeof c.email === "string" ? c.email : null,
    phone: typeof c.phone === "string" ? c.phone : null,
  };
}
