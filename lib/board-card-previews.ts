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

/** All previewable images per order — storage signed URLs and external URLs, in upload order. */
export async function thumbnailUrlsByOrder(
  assets: OrderAssetPreviewRow[],
  signPaths: (paths: string[]) => Promise<Map<string, string>>
): Promise<Record<string, string[]>> {
  const thumbnailsByOrder: Record<string, string[]> = {};
  // storage_path → order_id, preserving insertion order per order
  const pathsToSign: { path: string; orderId: string }[] = [];

  for (const asset of assets) {
    const external = asset.external_url?.trim();
    if (external && isImageExternalUrl(external)) {
      (thumbnailsByOrder[asset.order_id] ??= []).push(external);
      continue;
    }

    if (
      asset.storage_path &&
      isImageFileName(asset.file_name, asset.mime_type)
    ) {
      pathsToSign.push({ path: asset.storage_path, orderId: asset.order_id });
    }
  }

  if (pathsToSign.length > 0) {
    const signed = await signPaths(pathsToSign.map((p) => p.path));
    for (const { path, orderId } of pathsToSign) {
      const url = signed.get(path);
      if (url) (thumbnailsByOrder[orderId] ??= []).push(url);
    }
  }

  return thumbnailsByOrder;
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
