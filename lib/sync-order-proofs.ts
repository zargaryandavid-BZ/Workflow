import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  proofsDriveClient,
  findOrCreateProofsFolder,
  listProofFiles,
  listProofFilesRecursive,
  fetchPreviewBytes,
  type ProofFile,
} from "@/lib/gdrive-proofs";
import { matchProofsToSkus, sizeToken } from "@/lib/proof-sku-match";
import { normalizeSkus, type SkuItem } from "@/lib/skus";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { skuImageStoragePath } from "@/lib/sku-images";
import { listOrderGroupMembers } from "@/lib/ready-to-ship-group";

export type SyncOrderProofsSuccess = {
  ok: true;
  proofsFolderUrl: string;
  totalFiles: number;
  matched: number;
  filled: number;
  skippedAlreadyFilled: number;
  failed: string[];
  unmatchedFiles: string[];
  unfilledSkus: string[];
};

export type SyncOrderProofsFailure = {
  ok: false;
  status: 404 | 422 | 500;
  error: string;
};

export type SyncOrderProofsResult =
  | SyncOrderProofsSuccess
  | SyncOrderProofsFailure;

function extraNamesBySkuId(
  skus: SkuItem[],
  specs: Record<string, unknown>
): Record<string, string[]> {
  const title =
    typeof specs.webhook_item_title === "string"
      ? specs.webhook_item_title.trim()
      : "";
  if (!title || skus.length !== 1) return {};
  return { [skus[0]!.id]: [title] };
}

function mergeProofFiles(...lists: ProofFile[][]): ProofFile[] {
  const seen = new Set<string>();
  const out: ProofFile[] = [];
  for (const list of lists) {
    for (const file of list) {
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      out.push(file);
    }
  }
  return out;
}

/**
 * Pull proof / artwork files from Drive into the order's SKU gallery.
 * Looks in the Proofs subfolder first, then non-folder files in the designer
 * folder root (shared VDP PDFs, dielines). Idempotent for SKUs that already
 * have at least one image.
 */
export async function syncOrderProofs(
  supabase: SupabaseClient,
  tenantId: string,
  orderId: string
): Promise<SyncOrderProofsResult> {
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, title, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (orderErr) return { ok: false, status: 500, error: orderErr.message };
  if (!order) return { ok: false, status: 404, error: "Order not found" };

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const skus = normalizeSkus(specs.skus);
  if (skus.length === 0) {
    return {
      ok: false,
      status: 422,
      error: "This order has no SKUs/versions to fill.",
    };
  }

  const designerUrl =
    typeof specs.design_task === "string" ? specs.design_task : "";
  const designerFolderId = designerUrl ? parseDriveIdFromUrl(designerUrl) : null;
  if (!designerFolderId) {
    return {
      ok: false,
      status: 422,
      error:
        "No Drive folder for this order yet. Turn on automatic folder creation (Settings → Google Drive) and reopen the order, then try again.",
    };
  }

  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, tenantId);
  } catch {
    return { ok: false, status: 422, error: "Google Drive is not configured." };
  }

  let client;
  try {
    client = proofsDriveClient(settings);
  } catch (e) {
    return {
      ok: false,
      status: 422,
      error:
        e instanceof Error ? e.message : "Google Drive is not configured.",
    };
  }

  const proofsFolder = await findOrCreateProofsFolder(client, designerFolderId);
  const proofsFiles = await listProofFiles(client, proofsFolder.id);
  const treeFiles = await listProofFilesRecursive(client, designerFolderId, 2);
  const files = mergeProofFiles(proofsFiles, treeFiles);

  const members = await listOrderGroupMembers(supabase, tenantId, {
    id: order.id as string,
    title: String(order.title ?? ""),
    specs,
  });
  const attachLeftovers = members.length <= 1;

  const { data: existing } = await supabase
    .from("order_sku_images")
    .select("sku_id, position")
    .eq("order_id", orderId)
    .eq("tenant_id", tenantId);
  const filledSkuIds = new Set((existing ?? []).map((r) => r.sku_id as string));
  const nextPosition = new Map<string, number>();
  for (const row of existing ?? []) {
    const skuId = row.sku_id as string;
    const pos = typeof row.position === "number" ? row.position : 0;
    nextPosition.set(skuId, Math.max(nextPosition.get(skuId) ?? 0, pos + 1));
  }

  const cardSize =
    sizeToken(String(order.title ?? "")) || sizeToken(skus[0]?.name ?? "");
  const { matches, unmatched, unfilledSkus } = matchProofsToSkus(
    files,
    skus,
    cardSize,
    extraNamesBySkuId(skus, specs),
    { attachLeftovers }
  );

  let filled = 0;
  const failed: string[] = [];

  for (const m of matches) {
    if (filledSkuIds.has(m.skuId)) continue;
    let preview;
    try {
      preview = await fetchPreviewBytes(client, m.file);
    } catch {
      preview = null;
    }
    if (!preview) {
      failed.push(m.file.name);
      continue;
    }

    const baseName = m.file.name.replace(/\.[^.]+$/, "");
    const imageName = preview.contentType.includes("png")
      ? `${baseName}.png`
      : `${baseName}.jpg`;
    const position = nextPosition.get(m.skuId) ?? 0;
    const storagePath = skuImageStoragePath(
      tenantId,
      orderId,
      m.skuId,
      position,
      imageName
    );

    const { error: upErr } = await supabase.storage
      .from(ORDER_ASSETS_BUCKET)
      .upload(storagePath, preview.buffer, {
        contentType: preview.contentType || "image/jpeg",
        upsert: false,
      });
    if (upErr) {
      failed.push(m.file.name);
      continue;
    }

    const { error: dbErr } = await supabase.from("order_sku_images").insert({
      tenant_id: tenantId,
      order_id: orderId,
      sku_id: m.skuId,
      file_name: imageName,
      file_size: preview.buffer.byteLength,
      mime_type: preview.contentType || "image/jpeg",
      storage_path: storagePath,
      position,
    });
    if (dbErr) {
      await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([storagePath]);
      failed.push(m.file.name);
      continue;
    }
    nextPosition.set(m.skuId, position + 1);
    filled += 1;
  }

  return {
    ok: true,
    proofsFolderUrl: proofsFolder.webViewLink,
    totalFiles: files.length,
    matched: matches.length,
    filled,
    skippedAlreadyFilled: matches.length - filled - failed.length,
    failed,
    unmatchedFiles: unmatched.map((f) => f.name),
    unfilledSkus: unfilledSkus.map((s) => s.name),
  };
}
