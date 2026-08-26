import { versionToken } from "./proof-sku-match.ts";

export type WebhookArtworkFile = {
  id?: number;
  name?: string;
  url?: string;
  type?: string;
};

export type WebhookSkuArtInput = {
  sku_name?: string;
  quantity?: number | string;
  artwork_url?: string;
  image_url?: string;
  imageUrl?: string;
  thumbnail_url?: string;
  thumbnailUrl?: string;
  images?: unknown;
  artwork_files?: WebhookArtworkFile[];
  artworkFiles?: WebhookArtworkFile[];
  description?: string;
  comment?: string;
  line_item_comment?: string;
  line_comment?: string;
};

export type WebhookArtworkRef = {
  url: string;
  fileName?: string | null;
};

export type WebhookItemArtInput = {
  title?: string;
  artwork_url?: string;
  artwork_files?: WebhookArtworkFile[];
  skus?: WebhookSkuArtInput[];
};

function trimStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").pop() ?? "";
    return decodeURIComponent(last);
  } catch {
    const last = url.split("/").pop() ?? "";
    return last.split("?")[0] ?? "";
  }
}

function pushArtworkRef(
  out: WebhookArtworkRef[],
  url: unknown,
  fileName?: unknown
) {
  const href = trimStr(url);
  if (!href) return;
  if (out.some((r) => r.url === href)) return;
  const name = trimStr(fileName) || fileNameFromUrl(href) || null;
  out.push({ url: href, fileName: name });
}

/** CRM sends artwork under several aliases (`image_url`, `images[]`, …). */
export function skuArtworkRefs(sku: WebhookSkuArtInput): WebhookArtworkRef[] {
  const out: WebhookArtworkRef[] = [];
  pushArtworkRef(out, sku.artwork_url);
  pushArtworkRef(out, sku.image_url);
  pushArtworkRef(out, sku.imageUrl);
  pushArtworkRef(out, sku.thumbnail_url);
  pushArtworkRef(out, sku.thumbnailUrl);
  if (Array.isArray(sku.images)) {
    for (const img of sku.images) {
      if (typeof img === "string") {
        pushArtworkRef(out, img);
      } else if (img && typeof img === "object") {
        const rec = img as Record<string, unknown>;
        pushArtworkRef(
          out,
          rec.url ?? rec.image_url ?? rec.imageUrl,
          rec.name ?? rec.file_name
        );
      }
    }
  }
  const files = sku.artwork_files ?? sku.artworkFiles;
  if (Array.isArray(files)) {
    for (const af of files) {
      if (!af || typeof af !== "object") continue;
      pushArtworkRef(out, af.url, af.name);
    }
  }
  return out;
}

export function artworkNameTokensOverlap(a: string, b: string): boolean {
  const left = versionToken(a);
  const right = versionToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function artworkMatchesNames(
  fileNameOrUrl: string,
  names: string[]
): boolean {
  const label = fileNameFromUrl(fileNameOrUrl) || fileNameOrUrl;
  return names.some((n) => n.trim() && artworkNameTokensOverlap(label, n));
}

function itemMatchNames(
  item: WebhookItemArtInput,
  jobTitle: string
): string[] {
  const names = [jobTitle, trimStr(item.title)];
  for (const sku of item.skus ?? []) {
    const n = trimStr(sku.sku_name);
    if (n) names.push(n);
  }
  return [...new Set(names.filter(Boolean))];
}

function filterArtworkFiles(
  files: WebhookArtworkFile[] | undefined,
  names: string[]
): WebhookArtworkFile[] {
  if (!Array.isArray(files) || files.length === 0) return [];
  return files.filter((af) => {
    const url = trimStr(af?.url);
    if (!url) return false;
    const label = trimStr(af?.name) || fileNameFromUrl(url);
    return artworkMatchesNames(label, names);
  });
}

function withSkuArtwork(
  sku: WebhookSkuArtInput,
  refs: WebhookArtworkRef[]
): WebhookSkuArtInput {
  if (refs.length === 0) return sku;
  const files: WebhookArtworkFile[] = refs.map((r) => ({
    url: r.url,
    name: r.fileName ?? undefined,
  }));
  return {
    ...sku,
    artwork_url: sku.artwork_url || refs[0]?.url,
    artwork_files: files,
  };
}

function pickOrderSkusForItem(
  item: WebhookItemArtInput,
  orderSkus: WebhookSkuArtInput[] | undefined,
  names: string[],
  totalItems: number
): WebhookSkuArtInput[] | undefined {
  const own = Array.isArray(item.skus) && item.skus.length > 0 ? item.skus : [];
  const shared = Array.isArray(orderSkus) ? orderSkus : [];

  if (own.length > 0) {
    if (shared.length === 0 || totalItems <= 1) return own;
    return own.map((sku) => {
      if (skuArtworkRefs(sku).length > 0) return sku;
      const skuName = trimStr(sku.sku_name);
      const match = shared.find((s) => {
        const n = trimStr(s.sku_name);
        if (!n) return false;
        if (skuName && artworkNameTokensOverlap(n, skuName)) return true;
        return artworkMatchesNames(n, names);
      });
      return match ? withSkuArtwork(sku, skuArtworkRefs(match)) : sku;
    });
  }

  if (shared.length === 0) return own.length ? own : undefined;
  if (totalItems <= 1) return shared;

  const matched = shared.filter((s) => {
    const n = trimStr(s.sku_name);
    return n && artworkMatchesNames(n, names);
  });
  return matched.length > 0 ? matched : undefined;
}

/**
 * Bind CRM artwork to one line-item card.
 * Multi-item orders must not inherit the full order gallery — match by
 * SKU / line title (e.g. ZOAP_PREROLL vs WHITE WIDOW_PREROLL).
 */
export function resolveWebhookItemMedia<T extends WebhookItemArtInput>(
  item: T,
  order: {
    skus?: WebhookSkuArtInput[];
    artwork_url?: string;
    artwork_files?: WebhookArtworkFile[];
  },
  opts: { jobTitle: string; totalItems: number }
): T & {
  skus: WebhookSkuArtInput[] | undefined;
  artwork_url: string | undefined;
  artwork_files: WebhookArtworkFile[] | undefined;
} {
  const totalItems = opts.totalItems;
  const names = itemMatchNames(item, opts.jobTitle);
  const skus = pickOrderSkusForItem(item, order.skus, names, totalItems);

  const itemHadFiles =
    Array.isArray(item.artwork_files) && item.artwork_files.length > 0;
  const itemHadUrl = Boolean(trimStr(item.artwork_url));

  let artwork_files = itemHadFiles
    ? item.artwork_files
    : totalItems <= 1
      ? order.artwork_files
      : undefined;
  let artwork_url = itemHadUrl
    ? item.artwork_url
    : totalItems <= 1
      ? order.artwork_url
      : undefined;

  if (totalItems > 1) {
    const pool = itemHadFiles ? item.artwork_files : order.artwork_files;
    const matchedFiles = filterArtworkFiles(pool, names);
    if (matchedFiles.length > 0) {
      artwork_files = matchedFiles;
    } else if (!itemHadFiles) {
      artwork_files = undefined;
    }

    if (!itemHadUrl) {
      const orderUrl = trimStr(order.artwork_url);
      artwork_url =
        orderUrl && artworkMatchesNames(orderUrl, names)
          ? order.artwork_url
          : matchedFiles[0]?.url;
    } else if (matchedFiles.length > 0) {
      const still = matchedFiles.some(
        (f) => trimStr(f.url) === trimStr(item.artwork_url)
      );
      if (!still) artwork_url = matchedFiles[0]?.url;
    }
  }

  return {
    ...item,
    skus,
    artwork_url,
    artwork_files,
  };
}
