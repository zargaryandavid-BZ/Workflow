// POST /api/orders/[id]/setup-artwork-folders
// Build the designer's organized folder tree in the order's Drive folder:
// one working subfolder per version + a shared "Proofs" folder. Designers drop
// files straight into these (Drive-for-Desktop / WeTransfer→Drive), and the
// "Sync proofs" button later pulls the finished files back into the SKU images.
// Idempotent — re-running just fills in any missing folders.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ensureGdriveSettings } from "@/lib/gdrive-settings";
import { parseDriveIdFromUrl } from "@/lib/google-drive";
import { attachGdriveFoldersToOrders } from "@/lib/order-gdrive";
import { proofsDriveClient, ensureArtworkFolderTree } from "@/lib/gdrive-proofs";
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
    .select("id, title, customer_id, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  await attachGdriveFoldersToOrders(supabase, ctx.tenant.id, [
    {
      id: order.id as string,
      title: (order.title as string) ?? "",
      customer_id: (order.customer_id as string | null) ?? null,
      specs: (order.specs as Record<string, unknown> | null) ?? null,
    },
  ]);

  const { data: refreshed } = await supabase
    .from("orders")
    .select("specs")
    .eq("id", orderId)
    .maybeSingle();
  const specs = (refreshed?.specs ?? order.specs ?? {}) as Record<string, unknown>;
  const skus = normalizeSkus(specs.skus);
  if (skus.length === 0) {
    return NextResponse.json(
      { error: "This order has no versions/SKUs, so there are no folders to create." },
      { status: 422 }
    );
  }

  const designerUrl = typeof specs.design_task === "string" ? specs.design_task : "";
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

  const tree = await ensureArtworkFolderTree(
    client,
    designerFolderId,
    skus.map((s) => s.name)
  );

  const createdCount = tree.versions.filter((v) => v.created).length;
  return NextResponse.json({
    ok: true,
    proofsFolderUrl: tree.proofs.webViewLink,
    versionFolders: tree.versions.length,
    created: createdCount,
    alreadyThere: tree.versions.length - createdCount,
  });
}
