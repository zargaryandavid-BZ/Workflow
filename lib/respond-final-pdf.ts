import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_FIELD_NAME } from "@/lib/constants";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  downloadDriveFileBytes,
  isFinalProdFolderName,
  listChildFolders,
  listProofFiles,
  proofsDriveClient,
  type ProofFile,
  type ProofsDrive,
} from "@/lib/gdrive-proofs";
import {
  driveOrderKeyFromTitle,
  shortDriveOrderCode,
} from "@/lib/drive-folder-names";
import { matchProofsToSkus, sizeToken } from "@/lib/proof-sku-match";
import { normalizeSkus, type SkuItem } from "@/lib/skus";
import { driveFolderUrlFromOrderSpecs } from "@/lib/webhook-line-folder";
import {
  sharedPdfPagesForSkus,
  uniqueSharedPdfFile,
} from "@/lib/shared-pdf-pages";
import type { RespondFinalPdf } from "@/lib/respond-order";

export type { RespondFinalPdf };

function extraNamesBySkuId(
  skus: SkuItem[],
  specs: Record<string, unknown>,
  orderTitle: string
): Record<string, string[]> {
  const extras: string[] = [];
  const itemTitle =
    typeof specs.webhook_item_title === "string"
      ? specs.webhook_item_title.trim()
      : "";
  if (itemTitle) extras.push(itemTitle);
  const title = orderTitle.trim();
  if (title) extras.push(title);
  if (extras.length === 0) return {};
  const out: Record<string, string[]> = {};
  for (const sku of skus) out[sku.id] = extras;
  return out;
}

function isPdfFile(f: ProofFile): boolean {
  const mime = (f.mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return true;
  return f.name.toLowerCase().endsWith(".pdf");
}

async function artworkFolderId(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<string | null> {
  const { data: field } = await supabase
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", ARTWORK_FIELD_NAME)
    .maybeSingle();
  const fieldId = (field as { id: string } | null)?.id;
  if (!fieldId) return null;
  const { data: valueRow } = await supabase
    .from("custom_field_values")
    .select("value")
    .eq("order_id", orderId)
    .eq("custom_field_id", fieldId)
    .maybeSingle();
  const url =
    typeof (valueRow as { value?: unknown } | null)?.value === "string"
      ? String((valueRow as { value: string }).value).trim()
      : "";
  return url ? parseDriveIdFromUrl(url) : null;
}

function orderFolderNeedles(order: {
  title: string;
  specs: Record<string, unknown>;
}): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length >= 3) out.push(t.toLowerCase());
  };
  const title = String(order.title ?? "").trim();
  if (title) {
    push(title);
    const key = driveOrderKeyFromTitle(title);
    push(key);
    push(shortDriveOrderCode(key));
  }
  const webhook =
    typeof order.specs.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : "";
  if (webhook) push(webhook);
  const itemTitle =
    typeof order.specs.webhook_item_title === "string"
      ? order.specs.webhook_item_title.trim()
      : "";
  if (itemTitle) push(itemTitle);
  return [...new Set(out)];
}

function folderNameMatchesOrder(name: string, needles: string[]): boolean {
  const n = name.toLowerCase();
  return needles.some((needle) => n.includes(needle));
}

async function collectFinalFolderIds(
  client: ProofsDrive,
  seedIds: string[],
  extraRootId: string | null,
  orderNeedles: string[]
): Promise<string[]> {
  const ids = new Set<string>();
  for (const seed of seedIds) {
    if (!seed) continue;
    const children = await listChildFolders(client, seed);
    const finals = children.filter((child) => isFinalProdFolderName(child.name));
    if (finals.length > 0) {
      for (const child of finals) ids.add(child.id);
    } else {
      // Artwork / designer URL may already be the Final folder (no nested Final).
      ids.add(seed);
    }
  }
  if (extraRootId && orderNeedles.length > 0) {
    const children = await listChildFolders(client, extraRootId);
    for (const child of children) {
      if (
        isFinalProdFolderName(child.name) &&
        folderNameMatchesOrder(child.name, orderNeedles)
      ) {
        ids.add(child.id);
      }
    }
  }
  return [...ids];
}

const FINAL_PDF_CACHE_MS = 60_000;
const finalPdfCache = new Map<
  string,
  { at: number; value: Record<string, RespondFinalPdf> }
>();

/**
 * Map SKU id → multilayer PDF in the order's Final for Prod Drive folder.
 * Uses the same filename↔SKU matching as proof sync. Empty on any Drive miss.
 */
export async function fetchRespondFinalPdfsBySku(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[]
): Promise<Record<string, RespondFinalPdf>> {
  if (skus.length === 0) return {};
  const cacheKey = `${tenantId}:${order.id}`;
  const cached = finalPdfCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FINAL_PDF_CACHE_MS) {
    return cached.value;
  }

  const value = await fetchRespondFinalPdfsBySkuUncached(
    supabase,
    tenantId,
    order,
    skus
  );
  finalPdfCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

async function fetchRespondFinalPdfsBySkuUncached(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[]
): Promise<Record<string, RespondFinalPdf>> {
  if (skus.length === 0) return {};

  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, tenantId);
  } catch {
    return {};
  }

  let client: ProofsDrive;
  try {
    client = proofsDriveClient(settings);
  } catch {
    return {};
  }

  const specs = order.specs ?? {};
  const designerUrl = driveFolderUrlFromOrderSpecs(specs);
  const designerId = designerUrl ? parseDriveIdFromUrl(designerUrl) : null;
  const artId = await artworkFolderId(supabase, tenantId, order.id);
  const seeds = [...new Set([designerId, artId].filter(Boolean) as string[])];
  if (seeds.length === 0) return {};

  let folderIds: string[] = [];
  try {
    folderIds = await collectFinalFolderIds(
      client,
      seeds,
      settings.final_root_folder_id?.trim() || null,
      orderFolderNeedles(order)
    );
  } catch {
    return {};
  }
  if (folderIds.length === 0) return {};

  const files: ProofFile[] = [];
  const seen = new Set<string>();
  try {
    for (const fid of folderIds) {
      const listed = await listProofFiles(client, fid);
      for (const f of listed) {
        if (!isPdfFile(f) || seen.has(f.id)) continue;
        seen.add(f.id);
        files.push(f);
      }
    }
  } catch {
    return {};
  }
  if (files.length === 0) return {};

  const cardSize =
    sizeToken(String(order.title ?? "")) || sizeToken(skus[0]?.name ?? "");
  const { matches } = matchProofsToSkus(
    files,
    skus.length ? skus : normalizeSkus(specs.skus),
    cardSize,
    extraNamesBySkuId(skus, specs, String(order.title ?? "")),
    { attachLeftovers: true }
  );

  const out: Record<string, RespondFinalPdf> = {};
  for (const m of matches) {
    if (out[m.skuId]) continue;
    out[m.skuId] = { fileId: m.file.id, fileName: m.file.name };
  }

  // One production PDF (or the same file listed from two folders) is split
  // across SKUs: SKU 1 → page 1, SKU 2 → page 2.
  const shared = uniqueSharedPdfFile(files);
  if (shared) {
    return sharedPdfPagesForSkus(skus, shared);
  }
  return out;
}

export function skuListForFinalPdfs(
  orderTitle: string,
  skus: SkuItem[]
): SkuItem[] {
  if (skus.length > 0) return skus;
  return [
    {
      id: "__final_artwork__",
      name: String(orderTitle ?? "order").trim() || "order",
      qty: null,
    },
  ];
}

function uniquePdfsFromSkuMap(
  skuList: SkuItem[],
  map: Record<string, RespondFinalPdf>
): RespondFinalPdf[] {
  const unique: RespondFinalPdf[] = [];
  const seen = new Set<string>();
  for (const sku of skuList) {
    const pdf = map[sku.id];
    if (!pdf || seen.has(pdf.fileId)) continue;
    seen.add(pdf.fileId);
    unique.push({ fileId: pdf.fileId, fileName: pdf.fileName });
  }
  for (const pdf of Object.values(map)) {
    if (seen.has(pdf.fileId)) continue;
    seen.add(pdf.fileId);
    unique.push({ fileId: pdf.fileId, fileName: pdf.fileName });
  }
  return unique;
}

export async function isRespondFinalPdfForOrder(
  supabase: SupabaseClient,
  tenantId: string,
  order: { id: string; title: string; specs: Record<string, unknown> },
  skus: SkuItem[],
  fileId: string
): Promise<boolean> {
  const skuList = skuListForFinalPdfs(order.title, skus);
  const map = await fetchRespondFinalPdfsBySku(
    supabase,
    tenantId,
    order,
    skuList
  );
  return Object.values(map).some((p) => p.fileId === fileId);
}

/** Unique Final-for-Prod PDFs (one row per Drive file). */
export async function listUniqueFinalPdfs(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[]
): Promise<RespondFinalPdf[]> {
  const skuList = skuListForFinalPdfs(order.title, skus);
  const map = await fetchRespondFinalPdfsBySku(
    supabase,
    tenantId,
    order,
    skuList
  );
  return uniquePdfsFromSkuMap(skuList, map);
}

/**
 * Unique Final-for-Prod PDFs in SKU order (one buffer per Drive file).
 * Empty when Drive is missing or nothing is in Final.
 */
export async function downloadUniqueFinalPdfBuffers(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[]
): Promise<Buffer[]> {
  const unique = await listUniqueFinalPdfs(supabase, tenantId, order, skus);
  if (unique.length === 0) return [];

  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, tenantId);
  } catch {
    return [];
  }
  let client: ProofsDrive;
  try {
    client = proofsDriveClient(settings);
  } catch {
    return [];
  }

  const out: Buffer[] = [];
  for (const file of unique) {
    try {
      const downloaded = await downloadDriveFileBytes(client, file.fileId);
      if (downloaded?.buffer?.length) out.push(downloaded.buffer);
    } catch {
      /* skip this file */
    }
  }
  return out;
}
