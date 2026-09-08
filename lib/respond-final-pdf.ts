import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_FIELD_NAME } from "@/lib/constants";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  downloadDriveFileBytes,
  getDriveFileMeta,
  isFinalProdFolderName,
  listChildFolders,
  listProofFilesRecursive,
  proofsDriveClient,
  type ProofFile,
  type ProofsDrive,
} from "@/lib/gdrive-proofs";
import { type SkuItem } from "@/lib/skus";
import { pdfPageCount } from "@/lib/append-pdf";
import {
  alignSkusToPdfPages,
  pickFinalArtworkPdf,
  sharedPdfPagesForSkus,
} from "@/lib/shared-pdf-pages";
import type { RespondFinalPdf } from "@/lib/respond-order";
import {
  orderFolderNeedles,
  resolveOrderDriveFolders,
  seedDriveIdsFromOrder,
} from "@/lib/resolve-order-drive-folders";

export type { RespondFinalPdf };

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

async function collectResolvedFolders(
  client: ProofsDrive,
  seedIds: string[],
  extraRootId: string | null,
  excludeParentIds: string[],
  orderNeedles: string[]
) {
  return resolveOrderDriveFolders(client, {
    seedIds,
    extraRootId,
    excludeParentIds,
    orderNeedles,
  });
}

async function listPdfFilesInFolders(
  client: ProofsDrive,
  folderIds: string[]
): Promise<ProofFile[]> {
  const files: ProofFile[] = [];
  const seen = new Set<string>();
  for (const fid of folderIds) {
    const listed = await listProofFilesRecursive(client, fid);
    for (const f of listed) {
      if (!isPdfFile(f) || seen.has(f.id)) continue;
      seen.add(f.id);
      files.push(f);
    }
  }
  return files;
}

const FINAL_PDF_CACHE_MS = 60_000;
const PDF_PAGE_COUNT_MAX_BYTES = 80 * 1024 * 1024;

export type RespondArtworkPack = {
  skus: SkuItem[];
  bySku: Record<string, RespondFinalPdf>;
};

const EMPTY_PACK = (skus: SkuItem[]): RespondArtworkPack => ({
  skus,
  bySku: {},
});

const artworkPackCache = new Map<
  string,
  { at: number; value: RespondArtworkPack }
>();

async function pageCountForDrivePdf(
  client: ProofsDrive,
  fileId: string
): Promise<number> {
  try {
    const { resolveWebPreviewPdf } = await import("@/lib/gdrive-pdf-preview");
    const preview = await resolveWebPreviewPdf(client, fileId);
    if (preview?.buffer?.length) {
      return await pdfPageCount([preview.buffer]);
    }
    const meta = await getDriveFileMeta(client, fileId);
    if (!meta || meta.size > PDF_PAGE_COUNT_MAX_BYTES) return 0;
    const downloaded = await downloadDriveFileBytes(client, fileId);
    if (!downloaded?.buffer?.length) return 0;
    return await pdfPageCount([downloaded.buffer]);
  } catch {
    return 0;
  }
}

/**
 * Map SKU id → multilayer PDF page for customer / staff artwork.
 * Final production first; Designer folder if Final has no PDF (default).
 * Pass `{ includeDesignerFallback: false }` for job-ticket Final-only files.
 */
export async function fetchRespondArtworkPack(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[],
  opts?: { includeDesignerFallback?: boolean }
): Promise<RespondArtworkPack> {
  const ticket = skus.length > 0 ? skus : skuListForFinalPdfs(order.title, skus);
  const includeDesignerFallback = opts?.includeDesignerFallback ?? true;
  const cacheKey = `${includeDesignerFallback ? "staff:" : ""}${tenantId}:${order.id}:${ticket.map((s) => s.id).join(",")}`;
  const cached = artworkPackCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FINAL_PDF_CACHE_MS) {
    return cached.value;
  }

  const value = await fetchRespondArtworkPackUncached(
    supabase,
    tenantId,
    order,
    ticket,
    { includeDesignerFallback }
  );
  artworkPackCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

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
  const pack = await fetchRespondArtworkPack(supabase, tenantId, order, skus, {
    includeDesignerFallback: false,
  });
  return pack.bySku;
}

async function fetchRespondArtworkPackUncached(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[],
  opts?: { includeDesignerFallback?: boolean }
): Promise<RespondArtworkPack> {
  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, tenantId);
  } catch {
    return EMPTY_PACK(skus);
  }

  let client: ProofsDrive;
  try {
    client = proofsDriveClient(settings);
  } catch {
    return EMPTY_PACK(skus);
  }

  const specs = order.specs ?? {};
  const artId = await artworkFolderId(supabase, tenantId, order.id);
  const seeds = seedDriveIdsFromOrder({
    specs,
    artworkUrl: artId ? `https://drive.google.com/drive/folders/${artId}` : null,
  });
  if (seeds.length === 0) return EMPTY_PACK(skus);

  let files: ProofFile[] = [];
  try {
    const resolved = await collectResolvedFolders(
      client,
      seeds,
      settings.final_root_folder_id?.trim() || null,
      [
        settings.root_folder_id?.trim() || "",
        settings.shared_drive_id?.trim() || "",
      ].filter(Boolean),
      orderFolderNeedles(order)
    );
    files = await listPdfFilesInFolders(client, resolved.finalIds);
    if (files.length === 0 && opts?.includeDesignerFallback) {
      const designerFolders = new Set<string>();
      if (resolved.designerId) designerFolders.add(resolved.designerId);
      for (const seed of seeds) {
        if (!resolved.finalIds.includes(seed)) designerFolders.add(seed);
      }
      if (designerFolders.size > 0) {
        const extra: string[] = [...designerFolders];
        for (const id of [...designerFolders]) {
          try {
            const children = await listChildFolders(client, id);
            for (const child of children) {
              if (isFinalProdFolderName(child.name)) continue;
              extra.push(child.id);
            }
          } catch {
            /* designer root still listed below */
          }
        }
        files = await listPdfFilesInFolders(client, extra);
      }
    }
  } catch (err) {
    if (opts?.includeDesignerFallback) throw err;
    return EMPTY_PACK(skus);
  }
  if (files.length === 0) return EMPTY_PACK(skus);

  const file = pickFinalArtworkPdf(files);
  if (!file) return EMPTY_PACK(skus);

  const pageCount = await pageCountForDrivePdf(client, file.id);
  const aligned = pageCount >= 1 ? alignSkusToPdfPages(skus, pageCount) : skus;
  return {
    skus: aligned,
    bySku: sharedPdfPagesForSkus(aligned, file),
  };
}

/** Staff Artwork popup: Final production PDFs, or Designer folder PDFs if Final is empty. */
export async function fetchStaffArtworkPack(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[]
): Promise<RespondArtworkPack> {
  return fetchRespondArtworkPack(supabase, tenantId, order, skus, {
    includeDesignerFallback: true,
  });
}

export async function fetchStaffArtworkPdfsBySku(
  supabase: SupabaseClient,
  tenantId: string,
  order: {
    id: string;
    title: string;
    specs: Record<string, unknown>;
  },
  skus: SkuItem[]
): Promise<Record<string, RespondFinalPdf>> {
  return (await fetchStaffArtworkPack(supabase, tenantId, order, skus)).bySku;
}

export async function isStaffArtworkPdfForOrder(
  supabase: SupabaseClient,
  tenantId: string,
  order: { id: string; title: string; specs: Record<string, unknown> },
  skus: SkuItem[],
  fileId: string
): Promise<boolean> {
  const skuList = skuListForFinalPdfs(order.title, skus);
  const map = await fetchStaffArtworkPdfsBySku(
    supabase,
    tenantId,
    order,
    skuList
  );
  return Object.values(map).some((p) => p.fileId === fileId);
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
  const pack = await fetchRespondArtworkPack(
    supabase,
    tenantId,
    order,
    skuList
  );
  return Object.values(pack.bySku).some((p) => p.fileId === fileId);
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
