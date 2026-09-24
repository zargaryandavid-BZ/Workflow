export type SkuMainPicture = {
  sku_id: string;
  sku_name: string;
  url: string;
};

/**
 * One picture per SKU: first gallery row (already ordered by position),
 * then leftover sku_ids not listed in specs.skus.
 */
export function assembleSkuMainPictures(args: {
  skus: { id: string; name: string }[];
  imageRows: { sku_id: string; storage_path: string | null }[];
  urlByPath: Map<string, string>;
}): SkuMainPicture[] {
  const firstPathBySkuId = new Map<string, string>();
  for (const row of args.imageRows) {
    const path = row.storage_path?.trim();
    if (!path || !row.sku_id || firstPathBySkuId.has(row.sku_id)) continue;
    firstPathBySkuId.set(row.sku_id, path);
  }

  const pictures: SkuMainPicture[] = [];
  const used = new Set<string>();
  for (const sku of args.skus) {
    const path = firstPathBySkuId.get(sku.id);
    if (!path) continue;
    const url = args.urlByPath.get(path);
    if (!url) continue;
    pictures.push({
      sku_id: sku.id,
      sku_name: sku.name.trim() || "SKU",
      url,
    });
    used.add(sku.id);
  }
  for (const [skuId, path] of firstPathBySkuId) {
    if (used.has(skuId)) continue;
    const url = args.urlByPath.get(path);
    if (!url) continue;
    pictures.push({ sku_id: skuId, sku_name: "SKU", url });
  }
  return pictures;
}
