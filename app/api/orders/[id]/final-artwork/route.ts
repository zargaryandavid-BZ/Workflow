import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { skusForRespond } from "@/lib/respond-order";
import { skuLabel } from "@/lib/sku-approval";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET — list unique Final production PDFs, or stream one file.
 *   /api/orders/[id]/final-artwork
 *   /api/orders/[id]/final-artwork?fileId=
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const fileId = new URL(request.url).searchParams.get("fileId")?.trim() ?? "";
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, title, specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const orderRef = {
    id: order.id as string,
    title: String(order.title ?? ""),
    specs,
  };
  const skus = skusForRespond(specs);

  const {
    fetchStaffArtworkPack,
    skuListForFinalPdfs,
    isStaffArtworkPdfForOrder,
  } = await import("@/lib/respond-final-pdf");

  if (!fileId) {
    const skuList = skuListForFinalPdfs(orderRef.title, skus);
    let pack;
    try {
      pack = await fetchStaffArtworkPack(
        supabase,
        ctx.tenant.id,
        orderRef,
        skuList
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Drive lookup failed";
      console.error("[final-artwork]", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
    const bySku = pack.bySku;
    const items = pack.skus.flatMap((sku, i) => {
      const pdf = bySku[sku.id];
      if (!pdf) return [];
      return [
        {
          skuId: sku.id,
          skuLabel: skuLabel(i + 1, sku.name),
          fileId: pdf.fileId,
          fileName: pdf.fileName,
          page: pdf.page ?? null,
        },
      ];
    });
    const seen = new Set<string>();
    const files = items.filter((row) => {
      if (seen.has(row.fileId)) return false;
      seen.add(row.fileId);
      return true;
    }).map((row) => ({ fileId: row.fileId, fileName: row.fileName }));
    return NextResponse.json({ items, files });
  }

  let allowed = false;
  try {
    allowed = await isStaffArtworkPdfForOrder(
      supabase,
      ctx.tenant.id,
      orderRef,
      skus,
      fileId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Drive lookup failed";
    console.error("[final-artwork]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { ensureGdriveSettings } = await import("@/lib/gdrive-settings");
    const { proofsDriveClient, getDriveFileMeta } =
      await import("@/lib/gdrive-proofs");
    const settings = await ensureGdriveSettings(supabase, ctx.tenant.id);
    const client = proofsDriveClient(settings);
    const { resolveWebPreviewPdf } = await import("@/lib/gdrive-pdf-preview");
    const preview = await resolveWebPreviewPdf(client, fileId);
    if (preview) {
      return new NextResponse(new Uint8Array(preview.buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(preview.buffer.byteLength),
          "Content-Disposition": `inline; filename="${preview.name.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
          "X-Workflow-Pdf-Preview": preview.preview ? "1" : "0",
        },
      });
    }
    const meta = await getDriveFileMeta(client, fileId);
    if (!meta) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const mb = Math.round(meta.size / (1024 * 1024));
    return NextResponse.json(
      {
        error: `This PDF is ${mb} MB — too large to preview here. Generate a web preview (layers kept) with scripts/build-pdf-web-preview.ts`,
      },
      { status: 413 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    console.error("[final-artwork]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
