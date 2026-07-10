import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "@/lib/constants";
import {
  isEmptyFieldValue,
  orderFormFieldLabel,
  ORDER_FORM_PRINT_FIELD_NAMES,
} from "@/lib/order-form";
import { createAdminClient } from "@/lib/supabase/admin";
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
      return String(value);
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
      name.toLowerCase() === DESIGNER_FIELD_NAME.toLowerCase()
    ) {
      continue;
    }
    if (isEmptyFieldValue(raw)) continue;
    rows.push({ label: orderFormFieldLabel(name), value: String(raw) });
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

/** Staff-uploaded order + SKU artwork (excludes customer reply uploads). */
export async function fetchRespondOrderAssets(
  orderId: string
): Promise<RespondOrderAsset[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("assets")
    .select("id, file_name, mime_type, sku_key, size")
    .eq("order_id", orderId)
    .is("notification_id", null)
    .order("created_at", { ascending: true });

  return (data ?? []) as RespondOrderAsset[];
}

export interface RespondSkuImage {
  id: string;
  sku_id: string;
  file_name: string;
  mime_type: string | null;
  size: number | null;
}

/** Multi-image gallery images from order_sku_images, grouped by sku_id. */
export async function fetchRespondSkuImages(
  orderId: string
): Promise<Record<string, RespondSkuImage[]>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("order_sku_images")
    .select("id, sku_id, file_name, mime_type, size")
    .eq("order_id", orderId)
    .order("position", { ascending: true });

  const grouped: Record<string, RespondSkuImage[]> = {};
  for (const row of (data ?? []) as RespondSkuImage[]) {
    (grouped[row.sku_id] ??= []).push(row);
  }
  return grouped;
}

export function skusForRespond(specs: Record<string, unknown>): SkuItem[] {
  return normalizeSkus(specs.skus).filter((s) => s.name.trim() || s.qty != null);
}
