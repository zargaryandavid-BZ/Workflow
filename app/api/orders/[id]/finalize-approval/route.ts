// POST /api/orders/[id]/finalize-approval  { approvedVersions?: string[] }
// Customer approved (whole set, minus any they unchecked). The approved FULL-
// QUALITY files in the "Approval" folder graduate into "Final for Prod" — so
// production gets exactly what was approved, at full quality. If approvedVersions
// is omitted, every file in Approval is treated as approved.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  proofsDriveClient,
  ensureChildFolder,
  listProofFiles,
  moveFilesToFolder,
  APPROVAL_FOLDER_NAME,
  FINAL_PROD_FOLDER_NAME,
} from "@/lib/gdrive-proofs";
import { versionToken } from "@/lib/proof-sku-match";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { approvedVersions?: string[] };
  const approvedSet =
    Array.isArray(body.approvedVersions) && body.approvedVersions.length
      ? new Set(body.approvedVersions.map((v) => versionToken(v)))
      : null; // null = approve everything

  const supabase = await createClient();
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const designerUrl = typeof specs.design_task === "string" ? specs.design_task : "";
  const designerFolderId = designerUrl ? parseDriveIdFromUrl(designerUrl) : null;
  if (!designerFolderId) {
    return NextResponse.json({ error: "No Drive folder for this order yet." }, { status: 422 });
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
  const finalFolder = await ensureChildFolder(client, designerFolderId, FINAL_PROD_FOLDER_NAME);
  const files = await listProofFiles(client, approval.id);

  const toMove = approvedSet
    ? files.filter((f) => approvedSet.has(versionToken(f.name)))
    : files;
  const moved = await moveFilesToFolder(
    client,
    toMove.map((f) => f.id),
    approval.id,
    finalFolder.id
  );

  return NextResponse.json({
    ok: true,
    finalFolderUrl: finalFolder.webViewLink,
    approvedMoved: moved,
    rejectedLeftBehind: files.length - moved,
  });
}
