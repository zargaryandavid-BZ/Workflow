import {
  ARTWORK_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "@/lib/constants";
import {
  formatFieldDisplayValue,
  isEmptyFieldValue,
  orderFormFieldLabel,
  ORDER_FORM_PRINT_FIELD_NAMES,
} from "@/lib/order-form";
import { normalizeSkus, type SkuItem } from "@/lib/skus";

export interface RespondOrderRow {
  label: string;
  value: string;
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

/** Build labeled order rows mirroring the staff order detail form. */
export function buildRespondOrderRows(
  description: string | null,
  fields: Record<string, unknown>,
  specs: Record<string, unknown>
): RespondOrderRow[] {
  const rows: RespondOrderRow[] = [];
  const usedKeys = new Set<string>();

  for (const name of ORDER_FORM_PRINT_FIELD_NAMES) {
    if (name.toLowerCase() === DESIGNER_FIELD_NAME.toLowerCase()) continue;
    const value = pickFieldInsensitive(fields, name);
    if (value) {
      rows.push({ label: orderFormFieldLabel(name), value });
      usedKeys.add(name.toLowerCase());
    }
  }

  for (const [name, raw] of Object.entries(fields)) {
    const key = name.toLowerCase();
    if (usedKeys.has(key)) continue;
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
    rows.push({
      label: orderFormFieldLabel(name),
      value: formatFieldDisplayValue(raw),
    });
  }

  // Description appears last (bottom-left in the 2-column grid) before Designer.
  if (description?.trim()) {
    rows.push({ label: "Description", value: description.trim() });
  }

  const designerName =
    typeof specs.designer_name === "string" ? specs.designer_name.trim() : "";
  if (designerName) {
    rows.push({ label: "Designer", value: designerName });
  }

  return rows;
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
