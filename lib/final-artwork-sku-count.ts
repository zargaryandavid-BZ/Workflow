import "server-only";

import {
  layerPreviewObjectPath,
  respondPreviewIndexPath,
} from "@/lib/approval-layer-preview-paths";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { createAdminClient } from "@/lib/supabase/admin";
import sharp from "sharp";

type FinalArtworkIndex = {
  fileId: string;
  rev: string;
  pages: number[];
};

const previewKindCache = new Map<
  string,
  Promise<"artwork" | "composite">
>();

async function usablePreviewKind(
  index: FinalArtworkIndex
): Promise<"artwork" | "composite"> {
  const key = `${index.fileId}/${index.rev}`;
  const cached = previewKindCache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const admin = createAdminClient();
    const artworkPath = layerPreviewObjectPath(
      index.fileId,
      index.rev,
      index.pages[0],
      "artwork"
    );
    const { data, error } = await admin.storage
      .from(ORDER_ASSETS_BUCKET)
      .download(artworkPath);
    if (error || !data) return "composite" as const;
    try {
      const stats = await sharp(Buffer.from(await data.arrayBuffer())).stats();
      const rgb = stats.channels.slice(0, 3);
      const isBlankWhite =
        rgb.length === 3 &&
        rgb.every((channel) => channel.mean > 254.5 && channel.stdev < 0.5);
      return isBlankWhite ? ("composite" as const) : ("artwork" as const);
    } catch {
      return "composite" as const;
    }
  })();
  previewKindCache.set(key, pending);
  return pending;
}

async function loadFinalArtworkIndex(
  orderId: string
): Promise<FinalArtworkIndex | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .download(respondPreviewIndexPath(orderId));
  if (error || !data) return null;

  try {
    const parsed = JSON.parse(await data.text()) as {
      fileId?: unknown;
      rev?: unknown;
      pages?: unknown;
    };
    if (
      typeof parsed.fileId !== "string" ||
      !parsed.fileId.trim() ||
      typeof parsed.rev !== "string" ||
      !parsed.rev.trim() ||
      !Array.isArray(parsed.pages)
    ) {
      return null;
    }
    const pages = [
      ...new Set(
        parsed.pages.filter(
          (page): page is number =>
            typeof page === "number" && Number.isInteger(page) && page > 0
        )
      ),
    ].sort((a, b) => a - b);
    if (pages.length === 0) return null;
    return { fileId: parsed.fileId, rev: parsed.rev, pages };
  } catch {
    return null;
  }
}

/** Number of PDF pages in the stored Final Production proof (one page per SKU). */
export async function loadFinalArtworkSkuCount(
  orderId: string
): Promise<number | null> {
  const index = await loadFinalArtworkIndex(orderId);
  return index?.pages.length ?? null;
}

export async function loadFinalArtworkSummary(
  orderId: string
): Promise<{ count: number | null; artworkUrls: string[] }> {
  const index = await loadFinalArtworkIndex(orderId);
  if (!index) return { count: null, artworkUrls: [] };

  const admin = createAdminClient();
  const previewKind = await usablePreviewKind(index);
  const paths = index.pages.map((page) =>
    layerPreviewObjectPath(index.fileId, index.rev, page, previewKind)
  );
  const { data } = await admin.storage
    .from(ORDER_ASSETS_BUCKET)
    .createSignedUrls(paths, 3600);
  const artworkUrls = (data ?? [])
    .map((row) => (row.error ? null : row.signedUrl))
    .filter((url): url is string => Boolean(url));
  return { count: index.pages.length, artworkUrls };
}
