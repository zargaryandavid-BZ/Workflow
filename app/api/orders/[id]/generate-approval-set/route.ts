// POST /api/orders/[id]/generate-approval-set
// Designer drops finished FULL-QUALITY files into the order's Drive "Approval"
// folder. This reads them, makes a COMPRESSED copy of each (Drive thumbnail) into
// a fresh "Approval V<n>" folder, and returns the compressed set matched to the
// order's versions — that set feeds the approval window + the customer link.
// Originals stay untouched in "Approval" (full quality for production).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  proofsDriveClient,
  ensureChildFolder,
  listProofFiles,
  fetchPreviewBytes,
  uploadImageToFolder,
  nextApprovalVersionFolder,
  APPROVAL_FOLDER_NAME,
} from "@/lib/gdrive-proofs";
import { matchProofsToSkus, sizeToken } from "@/lib/proof-sku-match";
import { normalizeSkus } from "@/lib/skus";

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
  const designerUrl = typeof specs.design_task === "string" ? specs.design_task : "";
  const designerFolderId = designerUrl ? parseDriveIdFromUrl(designerUrl) : null;
  if (!designerFolderId) {
    return NextResponse.json(
      { error: "No Drive folder for this order yet (enable folder creation and reopen)." },
      { status: 422 }
    );
  }

  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, ctx.tenant.id);
  } catch {
    return NextResponse.json({ error: "Google Drive is not configured." }, { status: 422 });
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

  const approval = await ensureChildFolder(client, designerFolderId, APPROVAL_FOLDER_NAME);
  const files = await listProofFiles(client, approval.id);
  if (files.length === 0) {
    return NextResponse.json({
      ok: true,
      approvalFolderUrl: approval.webViewLink,
      versionFolder: null,
      previews: [],
      message: "The Approval folder is empty — drop the finished files there first.",
    });
  }

  const dest = await nextApprovalVersionFolder(client, designerFolderId);
  const cardSize = sizeToken(String(order.title ?? "")) || sizeToken(skus[0]?.name ?? "");
  const { matches } = matchProofsToSkus(files, skus, cardSize);
  const fileToVersion = new Map(matches.map((m) => [m.file.id, m.skuName]));

  const previews: { version: string | null; fileName: string; url: string }[] = [];
  for (const f of files) {
    let bytes;
    try {
      bytes = await fetchPreviewBytes(client, f);
    } catch {
      bytes = null;
    }
    if (!bytes) continue;
    const versionName = fileToVersion.get(f.id) ?? null;
    const base = (versionName || f.name.replace(/\.[^.]+$/, "")).replace(/[\\/]/g, "-");
    const name = bytes.contentType.includes("png") ? `${base}.png` : `${base}.jpg`;
    const up = await uploadImageToFolder(client, dest.id, name, bytes.buffer, bytes.contentType);
    previews.push({ version: versionName, fileName: f.name, url: up.webViewLink });
  }

  return NextResponse.json({
    ok: true,
    approvalFolderUrl: approval.webViewLink,
    versionFolder: dest.name,
    versionFolderUrl: dest.webViewLink,
    totalFiles: files.length,
    previews,
  });
}
