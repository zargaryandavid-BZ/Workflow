import {
  ARTWORK_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "./constants.ts";
import {
  formatFieldDisplayValue,
  isEmptyFieldValue,
  isOrderSizeDimensionField,
  orderFormFieldLabel,
  orderSizeDimensionRank,
  ORDER_FORM_PRINT_FIELD_NAMES,
} from "./order-form.ts";
import { parseSpecDisplay } from "./product-spec-options.ts";
import { normalizeSkus, type SkuItem } from "./skus.ts";

export interface RespondOrderRow {
  label: string;
  value: string;
  /** Width / Height / Depth — one 3-column row on `/respond`. */
  group?: "size";
}

export interface RespondOrderAsset {
  id: string;
  file_name: string;
  mime_type: string | null;
  sku_key: string | null;
  size: number | null;
}

function pickFieldInsensitive(
  fields: Record<string, unknown>,
  name: string
): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(fields)) {
    if (key.toLowerCase() === lower && !isEmptyFieldValue(value)) {
      return formatFieldDisplayValue(value);
    }
  }
  return null;
}

function respondRowForField(name: string, value: string): RespondOrderRow {
  return {
    label: orderFormFieldLabel(name),
    value,
    group: isOrderSizeDimensionField(name) ? "size" : undefined,
  };
}

function shouldSkipDieCut(
  name: string,
  dieValue: string | null
): boolean {
  return name.trim().toLowerCase() === "die cut" && Boolean(dieValue);
}

/** Size fields in one block; other rows keep print-field order around them. */
export function partitionRespondOrderRows(rows: RespondOrderRow[]): {
  before: RespondOrderRow[];
  size: RespondOrderRow[];
  after: RespondOrderRow[];
} {
  const size = rows
    .filter((row) => row.group === "size")
    .sort(
      (a, b) =>
        orderSizeDimensionRank(a.label) - orderSizeDimensionRank(b.label)
    );
  const before: RespondOrderRow[] = [];
  const after: RespondOrderRow[] = [];
  let seenSize = false;
  for (const row of rows) {
    if (row.group === "size") {
      seenSize = true;
      continue;
    }
    if (!seenSize) before.push(row);
    else after.push(row);
  }
  return { before, size, after };
}

/** Width/Height/Depth of 0 is "not set" (website flat items send 0). */
function isZeroSizeDimension(name: string, raw: unknown): boolean {
  if (!isOrderSizeDimensionField(name)) return false;
  const n = Number(String(raw).trim());
  return String(raw).trim() !== "" && Number.isFinite(n) && n === 0;
}

const SIZE_LABELS = new Set(["size", "finished size", "width", "height"]);
const FINISH_LABELS = new Set(["finishing", "lamination"]);

/** "Sides: 1 Side · Finishing: Gloss · Size: 8x3" lines written by the CRM. */
function crmProductionNoteSpecs(specs: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  let raw: unknown = specs.production_notes;
  // Stored as a JSON string of note entries on most cards.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  const texts: string[] = [];
  if (Array.isArray(raw)) {
    for (const n of raw) {
      if (n && typeof n === "object") {
        const rec = n as Record<string, unknown>;
        if (rec.author === "CRM" && typeof rec.text === "string") texts.push(rec.text);
      }
    }
  }
  for (const text of texts) {
    if (!text.includes(" · ") && !/^\s*(Finishing|Size):/m.test(text)) continue;
    for (const part of text.split(/ · |\n/)) {
      const m = /^\s*([A-Za-z ]{2,30}):\s*(.+?)\s*$/.exec(part);
      if (!m) continue;
      const key = m[1]!.trim().toLowerCase();
      if (!out.has(key)) out.set(key, m[2]!);
    }
  }
  return out;
}

/**
 * Specs the customer must see on the proof that only live in
 * `spec_selections` / the CRM spec line (Hayk #39 wrap roll size, #45 finishing):
 * Size from SET_SIZE, Finishing from the CRM line when the dropdown was blank.
 */
export function fallbackSpecRows(
  specs: Record<string, unknown>,
  usedLabels: Set<string>
): RespondOrderRow[] {
  const rows: RespondOrderRow[] = [];
  const has = (set: Set<string>) => [...set].some((l) => usedLabels.has(l));
  const sel =
    specs.spec_selections && typeof specs.spec_selections === "object" && !Array.isArray(specs.spec_selections)
      ? (specs.spec_selections as Record<string, unknown>)
      : {};
  const notes = crmProductionNoteSpecs(specs);

  if (!has(SIZE_LABELS)) {
    let size = "";
    for (const [k, v] of Object.entries(sel)) {
      if (!/^SET_SIZE(_\d+)?$/i.test(k)) continue;
      const t = typeof v === "string" ? v.trim() : "";
      if (t && t.toLowerCase() !== "custom") {
        size = t;
        break;
      }
    }
    if (!size) size = notes.get("size") ?? "";
    if (size) rows.push({ label: "Size", value: size });
  }
  if (!has(FINISH_LABELS)) {
    const fin = notes.get("finishing") ?? "";
    if (fin) rows.push({ label: "Finishing", value: fin });
  }
  return rows;
}

/** Build labeled order rows mirroring the staff order detail form. */
export function buildRespondOrderRows(
  description: string | null,
  fields: Record<string, unknown>,
  specs: Record<string, unknown>
): RespondOrderRow[] {
  const rows: RespondOrderRow[] = [];
  const usedKeys = new Set<string>();
  const usedLabels = new Set<string>();
  const dieValue = pickFieldInsensitive(fields, "Die");

  const pushRow = (name: string, value: string) => {
    const row = respondRowForField(name, value);
    rows.push(row);
    usedKeys.add(name.toLowerCase());
    usedLabels.add(row.label.trim().toLowerCase());
  };

  for (const name of ORDER_FORM_PRINT_FIELD_NAMES) {
    if (name.toLowerCase() === DESIGNER_FIELD_NAME.toLowerCase()) continue;
    if (shouldSkipDieCut(name, dieValue)) continue;
    const value = pickFieldInsensitive(fields, name);
    if (value && !isZeroSizeDimension(name, value)) pushRow(name, value);
  }

  for (const [name, raw] of Object.entries(fields)) {
    const key = name.toLowerCase();
    if (usedKeys.has(key)) continue;
    if (shouldSkipDieCut(name, dieValue)) continue;
    if (
      name === CUSTOMER_NAME_FIELD_NAME ||
      name === CUSTOMER_CONTACT_FIELD_NAME ||
      name.toLowerCase() === DESIGNER_FIELD_NAME.toLowerCase() ||
      name.toLowerCase() === ARTWORK_FIELD_NAME.toLowerCase() ||
      key === "unit price" ||
      key === "unit price ($)"
    ) {
      continue;
    }
    if (isEmptyFieldValue(raw)) continue;
    if (isZeroSizeDimension(name, raw)) continue;
    pushRow(name, formatFieldDisplayValue(raw));
  }

  for (const specRow of parseSpecDisplay(specs.spec_display)) {
    const labelKey = specRow.label.trim().toLowerCase();
    const nameKey = specRow.key.trim().toLowerCase();
    if (usedLabels.has(labelKey)) continue;
    if (nameKey && usedKeys.has(nameKey)) continue;
    if (shouldSkipDieCut(specRow.label, dieValue)) continue;
    rows.push({
      label: specRow.label,
      value: specRow.value,
      group: isOrderSizeDimensionField(specRow.label) ? "size" : undefined,
    });
    usedLabels.add(labelKey);
    if (nameKey) usedKeys.add(nameKey);
  }

  for (const extra of fallbackSpecRows(specs, usedLabels)) {
    rows.push(extra);
    usedLabels.add(extra.label.trim().toLowerCase());
  }

  const designerName =
    typeof specs.designer_name === "string" ? specs.designer_name.trim() : "";
  if (designerName) {
    rows.push({ label: "Designer", value: designerName });
  }

  return rows;
}

/** Staff “Customer note” for the portal — facing note, then order description. */
export function respondCustomerNote(
  description: string | null | undefined,
  specs: Record<string, unknown> | null | undefined
): string | null {
  const facing =
    typeof specs?.customer_facing_note === "string"
      ? specs.customer_facing_note.trim()
      : "";
  if (facing) return facing;
  const desc = description?.trim() ?? "";
  return desc || null;
}

export function isRespondImageAsset(
  fileName: string,
  mimeType?: string | null
): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "svg", "webp", "gif"].includes(ext)) return true;
  const m = mimeType?.toLowerCase() ?? "";
  return m.startsWith("image/");
}

export function respondAssetUrl(token: string, assetId: string): string {
  return `/api/notifications/asset?token=${encodeURIComponent(token)}&id=${encodeURIComponent(assetId)}`;
}

export function respondSkuImageUrl(token: string, imageId: string): string {
  return `/api/notifications/asset?token=${encodeURIComponent(token)}&id=${encodeURIComponent(imageId)}&type=sku_image`;
}

export type RespondFinalPdf = {
  fileId: string;
  fileName: string;
  /** 1-based PDF page for this SKU (page 1 = SKU 1). Names are ignored. */
  page?: number;
};

export { sharedPdfPagesForSkus } from "./shared-pdf-pages.ts";

export function respondFinalPdfUrl(
  token: string,
  orderId: string,
  fileId: string
): string {
  return `/api/notifications/asset?token=${encodeURIComponent(token)}&id=${encodeURIComponent(fileId)}&type=final_pdf&order=${encodeURIComponent(orderId)}`;
}

export interface RespondSkuImage {
  id: string;
  sku_id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
}

export function skusForRespond(specs: Record<string, unknown>): SkuItem[] {
  return normalizeSkus(specs.skus).filter((s) => s.name.trim() || s.qty != null);
}

export type SkuApprovalImageRef = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size: number | null;
  source: "asset" | "gallery";
};

/** Artwork files for a SKU: assets with matching sku_key, plus gallery images. */
export function collectSkuApprovalImages(
  skuId: string,
  assets: RespondOrderAsset[],
  gallery: Record<string, RespondSkuImage[]> = {}
): SkuApprovalImageRef[] {
  const seen = new Set<string>();
  const out: SkuApprovalImageRef[] = [];
  for (const asset of assets) {
    if (asset.sku_key !== skuId) continue;
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    out.push({
      id: asset.id,
      file_name: asset.file_name,
      mime_type: asset.mime_type,
      size: asset.size,
      source: "asset",
    });
  }
  for (const img of gallery[skuId] ?? []) {
    if (seen.has(img.id)) continue;
    seen.add(img.id);
    out.push({
      id: img.id,
      file_name: img.file_name,
      mime_type: img.mime_type,
      size: img.file_size,
      source: "gallery",
    });
  }
  return out;
}

export function imagesBySkuId(
  skus: { id: string }[],
  assets: RespondOrderAsset[],
  gallery: Record<string, RespondSkuImage[]> = {}
): Record<string, SkuApprovalImageRef[]> {
  const map: Record<string, SkuApprovalImageRef[]> = {};
  for (const sku of skus) {
    map[sku.id] = collectSkuApprovalImages(sku.id, assets, gallery);
  }
  return map;
}
