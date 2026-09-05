import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { skusForRespond } from "@/lib/respond-order";
import { skuLabel } from "@/lib/sku-approval";

/** Staff preview of Final-for-Prod PDFs. Same size cap as customer /respond. */
const FINAL_PDF_PREVIEW_MAX_BYTES = 200 * 1024 * 1024;

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
    const { proofsDriveClient, downloadDriveFileBytes, getDriveFileMeta } =
      await import("@/lib/gdrive-proofs");
    const settings = await ensureGdriveSettings(supabase, ctx.tenant.id);
    const client = proofsDriveClient(settings);
    const meta = await getDriveFileMeta(client, fileId);
    if (!meta) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (meta.size > FINAL_PDF_PREVIEW_MAX_BYTES) {
      const mb = Math.round(meta.size / (1024 * 1024));
      return NextResponse.json(
        {
          error: `This PDF is ${mb} MB — too large to preview here. Open it in Acrobat from Drive.`,
        },
        { status: 413 }
      );
    }
    const downloaded = await downloadDriveFileBytes(client, fileId);
    if (!downloaded) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = Buffer.from(downloaded.buffer);
    return new NextResponse(body, {
      headers: {
        "Content-Type": downloaded.mimeType.includes("pdf")
          ? "application/pdf"
          : downloaded.mimeType,
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `inline; filename="${downloaded.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=120",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    console.error("[final-artwork]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
