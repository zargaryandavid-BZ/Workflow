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
  return /(\.(png|jpe?g|gif|webp|svg)(\?|$)|googleusercontent\.com|drive\.google\.com.*[?&]id=)/i.test(
    trimmed
  );
}

export interface OrderAssetPreviewRow {
  order_id: string;
  storage_path: string | null;
  external_url?: string | null;
  file_name: string;
  mime_type: string | null;
  created_at: string;
}

/** First previewable image per order — storage signed URL or external URL. */
export async function thumbnailUrlsByOrder(
  assets: OrderAssetPreviewRow[],
  signPaths: (paths: string[]) => Promise<Map<string, string>>
): Promise<Record<string, string>> {
  const thumbnailByOrder: Record<string, string> = {};
  const pathsToSign = new Map<string, string>();

  for (const asset of assets) {
    if (thumbnailByOrder[asset.order_id]) continue;

    const external = asset.external_url?.trim();
    if (external && isImageExternalUrl(external)) {
      thumbnailByOrder[asset.order_id] = external;
      continue;
    }

    if (
      asset.storage_path &&
      isImageFileName(asset.file_name, asset.mime_type)
    ) {
      pathsToSign.set(asset.storage_path, asset.order_id);
    }
  }

  if (pathsToSign.size > 0) {
    const signed = await signPaths([...pathsToSign.keys()]);
    for (const [path, orderId] of pathsToSign) {
      if (thumbnailByOrder[orderId]) continue;
      const url = signed.get(path);
      if (url) thumbnailByOrder[orderId] = url;
    }
  }

  return thumbnailByOrder;
}

export function designerNamesByOrder(
  orders: { id: string; specs?: Record<string, unknown> | null }[],
  designerNameById: Map<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const order of orders) {
    const specs = order.specs ?? {};
    const stored =
      typeof specs.designer_name === "string" ? specs.designer_name.trim() : "";
    if (stored) {
      out[order.id] = stored;
      continue;
    }
    const id =
      typeof specs.designer_id === "string" ? specs.designer_id.trim() : "";
    if (id) {
      const resolved = designerNameById.get(id);
      if (resolved) out[order.id] = resolved;
    }
  }
  return out;
}
