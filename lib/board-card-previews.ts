import type { BoardThumbnail, CardImageSource } from "@/lib/card-image";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

export function isImageFileName(
  fileName: string,
  mimeType?: string | null
): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXT.has(ext)) return true;
  const m = mimeType?.toLowerCase();
  return Boolean(m?.startsWith("image/"));
}

export function isImageExternalUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const pathname = new URL(trimmed).pathname.toLowerCase();
    const ext = pathname.split(".").pop() ?? "";
    if (IMAGE_EXT.has(ext)) return true;
  } catch {
    // fall through
  }
  if (
    /(\.(png|jpe?g|gif|webp|svg)(\?|$)|googleusercontent\.com|drive\.google\.com.*[?&]id=)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  // CRM file APIs often have no extension (`/files/<id>`). Still preview
  // those; skip known non-image documents so PDFs don't show as a blank tile.
  try {
    const last = new URL(trimmed).pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    const ext = dot >= 0 ? last.slice(dot + 1).toLowerCase() : "";
    if (["pdf", "ai", "eps", "zip", "psd", "tif", "tiff"].includes(ext)) {
      return false;
    }
    return trimmed.startsWith("http://") || trimmed.startsWith("https://");
  } catch {
    return false;
  }
}

export interface OrderAssetPreviewRow {
  order_id: string;
  id?: string;
  source?: CardImageSource;
  storage_path: string | null;
  external_url?: string | null;
  file_name: string;
  mime_type: string | null;
  created_at: string;
}

/** Previewable images per order with ids so the board can pin a card picture. */
export async function boardThumbnailsByOrder(
  assets: OrderAssetPreviewRow[],
  signPaths: (paths: string[]) => Promise<Map<string, string>>
): Promise<Record<string, BoardThumbnail[]>> {
  const thumbnailsByOrder: Record<string, BoardThumbnail[]> = {};
  const pathsToSign: {
    path: string;
    orderId: string;
    id: string;
    source: CardImageSource;
  }[] = [];

  for (const asset of assets) {
    const source = asset.source ?? "asset";
    const id = asset.id?.trim() ?? "";
    // Prefer stored bytes when present (portal external_url is auth-gated).
    if (
      asset.storage_path &&
      isImageFileName(asset.file_name, asset.mime_type)
    ) {
      if (!id) continue;
      pathsToSign.push({
        path: asset.storage_path,
        orderId: asset.order_id,
        id,
        source,
      });
      continue;
    }

    const external = asset.external_url?.trim();
    if (external && isImageExternalUrl(external) && id) {
      (thumbnailsByOrder[asset.order_id] ??= []).push({
        url: external,
        id,
        source,
      });
    }
  }

  if (pathsToSign.length > 0) {
    const signed = await signPaths(pathsToSign.map((p) => p.path));
    for (const { path, orderId, id, source } of pathsToSign) {
      const url = signed.get(path);
      if (url) (thumbnailsByOrder[orderId] ??= []).push({ url, id, source });
    }
  }

  return thumbnailsByOrder;
}

/** All previewable images per order — storage signed URLs and external URLs, in upload order. */
export async function thumbnailUrlsByOrder(
  assets: OrderAssetPreviewRow[],
  signPaths: (paths: string[]) => Promise<Map<string, string>>
): Promise<Record<string, string[]>> {
  const byOrder = await boardThumbnailsByOrder(assets, signPaths);
  const thumbnailsByOrder: Record<string, string[]> = {};
  for (const [orderId, thumbs] of Object.entries(byOrder)) {
    thumbnailsByOrder[orderId] = thumbs.map((t) => t.url);
  }
  return thumbnailsByOrder;
}

/** Display name follows `designer_id`; stored `designer_name` is only a fallback. */
export function resolveDesignerDisplayName(
  specs: Record<string, unknown> | null | undefined,
  designerNameById: Map<string, string>
): string {
  const id =
    typeof specs?.designer_id === "string" ? specs.designer_id.trim() : "";
  if (id) {
    const resolved = designerNameById.get(id)?.trim();
    if (resolved) return resolved;
  }
  const stored =
    typeof specs?.designer_name === "string" ? specs.designer_name.trim() : "";
  return stored;
}

export function designerNamesByOrder(
  orders: { id: string; specs?: Record<string, unknown> | null }[],
  designerNameById: Map<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const order of orders) {
    const name = resolveDesignerDisplayName(order.specs, designerNameById);
    if (name) out[order.id] = name;
  }
  return out;
}

/** Card Owner: account manager (`created_by`) or webhook `request_owner_name`. */
export function ownerNamesByOrder(
  orders: {
    id: string;
    created_by?: string | null;
    specs?: Record<string, unknown> | null;
  }[],
  ownerNameById: Map<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const order of orders) {
    const createdBy =
      typeof order.created_by === "string" ? order.created_by.trim() : "";
    if (createdBy) {
      const resolved = ownerNameById.get(createdBy);
      if (resolved) {
        out[order.id] = resolved;
        continue;
      }
    }

    const specs = order.specs ?? {};
    const requestOwnerName =
      typeof specs.request_owner_name === "string"
        ? specs.request_owner_name.trim()
        : "";
    if (requestOwnerName) {
      out[order.id] = requestOwnerName;
    }
  }
  return out;
}
