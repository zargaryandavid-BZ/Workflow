/**
 * Customer reference files attached when a proof is NOT approved
 * ("request changes") on the public /respond page.
 *
 * Storage: same `order-assets` bucket + `assets` table as missing-info reply
 * uploads (row tied to the approval notification via `notification_id`), but
 * under a dedicated folder so they are never mistaken for artwork:
 *
 *   <tenant>/<order>/customer-references/<notification>/<all|sku-<id>>/<ts>-<name>
 *
 * `sku_key` is intentionally left NULL on these rows — a non-null sku_key would
 * make the file count as SKU artwork (portal artwork feed, SKU galleries). The
 * SKU a reference belongs to is carried in the path segment instead.
 *
 * Pure helpers only (no Supabase / React) so they are unit-testable with
 * `node --test`.
 */

export const CUSTOMER_REFERENCE_DIR = "customer-references";

/** Same per-file cap as missing-info uploads. */
export const REFERENCE_MAX_BYTES = 50 * 1024 * 1024;

/** Max reference files per approval response (abuse guard). */
export const REFERENCE_MAX_FILES = 25;

/** Images + PDFs. */
export const REFERENCE_ALLOWED_EXT = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "heic",
  "heif",
]);

/** `accept` for the file input — `image/*` lets phones offer camera + photos. */
export const REFERENCE_ACCEPT =
  "image/*,.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.heif,application/pdf";

export const REFERENCE_TYPES_LABEL = "Images (PNG, JPG, WEBP, HEIC) or PDF";

const BROWSER_PREVIEW_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isAllowedReferenceFile(name: string): boolean {
  return REFERENCE_ALLOWED_EXT.has(fileExtension(name));
}

/** True when a browser can render the file as an <img> thumbnail. */
export function isPreviewableReferenceImage(
  name: string,
  mimeType?: string | null
): boolean {
  const ext = fileExtension(name);
  if (BROWSER_PREVIEW_EXT.has(ext)) return true;
  if (ext === "heic" || ext === "heif" || ext === "pdf") return false;
  const m = (mimeType ?? "").toLowerCase();
  return (
    m === "image/png" ||
    m === "image/jpeg" ||
    m === "image/webp" ||
    m === "image/gif"
  );
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Storage folder (with trailing slash) for one approval response. */
export function referenceFolderPrefix(
  tenantId: string,
  orderId: string,
  notificationId: string
): string {
  return `${tenantId}/${orderId}/${CUSTOMER_REFERENCE_DIR}/${safeSegment(notificationId)}/`;
}

export function referenceStoragePath(args: {
  tenantId: string;
  orderId: string;
  notificationId: string;
  skuId?: string | null;
  fileName: string;
  now?: number;
}): string {
  const skuSeg = args.skuId?.trim()
    ? `sku-${safeSegment(args.skuId.trim())}`
    : "all";
  const ts = args.now ?? Date.now();
  return `${referenceFolderPrefix(args.tenantId, args.orderId, args.notificationId)}${skuSeg}/${ts}-${safeSegment(args.fileName)}`;
}

/** True for any path stored by the reference uploader. */
export function isCustomerReferencePath(
  path: string | null | undefined
): boolean {
  if (!path) return false;
  return path.split("/").includes(CUSTOMER_REFERENCE_DIR);
}

/** Path guard for the "complete" step: must sit in this response's folder. */
export function ownsReferencePath(
  path: string,
  tenantId: string,
  orderId: string,
  notificationId: string
): boolean {
  if (!path || path.includes("..")) return false;
  return path.startsWith(referenceFolderPrefix(tenantId, orderId, notificationId));
}

/** SKU id encoded in a reference path, or null for whole-response references. */
export function referenceSkuIdFromPath(
  path: string | null | undefined
): string | null {
  if (!path) return null;
  const parts = path.split("/");
  const idx = parts.indexOf(CUSTOMER_REFERENCE_DIR);
  if (idx < 0) return null;
  const seg = parts[idx + 2] ?? "";
  return seg.startsWith("sku-") && seg.length > 4 ? seg.slice(4) : null;
}

/** Display-ready reference file (staff UI + activity metadata). */
export type CustomerReferenceFile = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size: number | null;
  /** e.g. "SKU 2 — Caviar"; null when the file applies to the whole proof. */
  sku_label: string | null;
};

type SkuLike = { id: string; name?: string | null };

/** "SKU n — name" for the SKU encoded in the path (null if none / unknown). */
export function referenceSkuLabel(
  path: string | null | undefined,
  skus: SkuLike[]
): string | null {
  const skuId = referenceSkuIdFromPath(path);
  if (!skuId) return null;
  const index = skus.findIndex((s) => s.id === skuId);
  if (index < 0) return null;
  const name = skus[index]?.name?.trim() ?? "";
  return name ? `SKU ${index + 1} — ${name}` : `SKU ${index + 1}`;
}

export function toCustomerReferenceFiles(
  assets: {
    id: string;
    file_name: string;
    mime_type?: string | null;
    size?: number | null;
    storage_path?: string | null;
  }[],
  skus: SkuLike[] = []
): CustomerReferenceFile[] {
  return assets
    .filter((a) => isCustomerReferencePath(a.storage_path))
    .map((a) => ({
      id: a.id,
      file_name: a.file_name,
      mime_type: a.mime_type ?? null,
      size: typeof a.size === "number" ? a.size : null,
      sku_label: referenceSkuLabel(a.storage_path, skus),
    }));
}

/** Reads `reference_files` from activity metadata (tolerant of bad data). */
export function parseReferenceFilesMeta(
  meta: Record<string, unknown> | null | undefined
): CustomerReferenceFile[] {
  const raw = meta?.reference_files;
  if (!Array.isArray(raw)) return [];
  const out: CustomerReferenceFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const fileName = typeof r.file_name === "string" ? r.file_name : "";
    if (!id || !fileName) continue;
    out.push({
      id,
      file_name: fileName,
      mime_type: typeof r.mime_type === "string" ? r.mime_type : null,
      size: typeof r.size === "number" ? r.size : null,
      sku_label:
        typeof r.sku_label === "string" && r.sku_label.trim()
          ? r.sku_label.trim()
          : null,
    });
  }
  return out;
}

/** Group by SKU label, whole-proof references first. */
export function groupReferenceFiles(
  files: CustomerReferenceFile[]
): { label: string | null; files: CustomerReferenceFile[] }[] {
  const groups = new Map<string | null, CustomerReferenceFile[]>();
  for (const f of files) {
    const list = groups.get(f.sku_label) ?? [];
    list.push(f);
    groups.set(f.sku_label, list);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  return keys.map((label) => ({ label, files: groups.get(label) ?? [] }));
}

/** Staff URLs (authenticated /api/assets route). */
export function referenceViewUrl(assetId: string): string {
  return `/api/assets/${assetId}?inline=1`;
}

export function referenceDownloadUrl(assetId: string): string {
  return `/api/assets/${assetId}`;
}
