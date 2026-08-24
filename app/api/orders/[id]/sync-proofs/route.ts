// POST /api/orders/[id]/sync-proofs
// Pull the finished files from this order's Drive "Proofs" folder and fill the
// matching SKU gallery images automatically — replacing the manual screenshot +
// upload + rename of every version slot. Idempotent: skips SKUs that already
// have an image, so it is safe to re-run as more proofs land.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  proofsDriveClient,
  findOrCreateProofsFolder,
  listProofFiles,
  fetchPreviewBytes,
} from "@/lib/gdrive-proofs";
import { matchProofsToSkus, sizeToken } from "@/lib/proof-sku-match";
import { normalizeSkus } from "@/lib/skus";
import { ORDER_ASSETS_BUCKET } from "@/lib/order-assets";
import { skuImageStoragePath } from "@/lib/sku-images";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, title, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const skus = normalizeSkus(specs.skus);
  if (skus.length === 0) {
    return NextResponse.json(
      { error: "This order has no SKUs/versions to fill." },
      { status: 422 }
    );
  }

  const designerUrl =
    typeof specs.design_task === "string" ? specs.design_task : "";
  const designerFolderId = designerUrl ? parseDriveIdFromUrl(designerUrl) : null;
  if (!designerFolderId) {
    return NextResponse.json(
      {
        error:
          "No Drive folder for this order yet. Turn on automatic folder creation (Settings → Google Drive) and reopen the order, then try again.",
      },
      { status: 422 }
    );
  }

  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, ctx.tenant.id);
  } catch {
    return NextResponse.json(
      { error: "Google Drive is not configured." },
      { status: 422 }
    );
  }

  let client;
  try {
    client = proofsDriveClient(settings);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Google Drive is not configured." },
      { status: 422 }
    );
  }

  const proofsFolder = await findOrCreateProofsFolder(client, designerFolderId);
  const files = await listProofFiles(client, proofsFolder.id);

  // Which SKUs already have at least one image → never overwrite the team's work.
  const { data: existing } = await supabase
    .from("order_sku_images")
    .select("sku_id")
    .eq("order_id", orderId)
    .eq("tenant_id", ctx.tenant.id);
  const filledSkuIds = new Set((existing ?? []).map((r) => r.sku_id as string));

  const cardSize = sizeToken(String(order.title ?? "")) || sizeToken(skus[0]?.name ?? "");
  const { matches, unmatched, unfilledSkus } = matchProofsToSkus(files, skus, cardSize);

  let filled = 0;
  const failed: string[] = [];

  for (const m of matches) {
    if (filledSkuIds.has(m.skuId)) continue; // idempotent
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
    const storagePath = skuImageStoragePath(
      ctx.tenant.id,
      orderId,
      m.skuId,
      0,
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
      tenant_id: ctx.tenant.id,
      order_id: orderId,
      sku_id: m.skuId,
      file_name: imageName,
      file_size: preview.buffer.byteLength,
      mime_type: preview.contentType || "image/jpeg",
      storage_path: storagePath,
      position: 0,
    });
    if (dbErr) {
      await supabase.storage.from(ORDER_ASSETS_BUCKET).remove([storagePath]);
      failed.push(m.file.name);
      continue;
    }
    filledSkuIds.add(m.skuId);
    filled += 1;
  }

  return NextResponse.json({
    ok: true,
    proofsFolderUrl: proofsFolder.webViewLink,
    totalFiles: files.length,
    matched: matches.length,
    filled,
    skippedAlreadyFilled: matches.length - filled - failed.length,
    failed,
    unmatchedFiles: unmatched.map((f) => f.name),
    unfilledSkus: unfilledSkus.map((s) => s.name),
  });
}
