import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { skusForRespond } from "@/lib/respond-order";

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
    listUniqueFinalPdfs,
    isRespondFinalPdfForOrder,
  } = await import("@/lib/respond-final-pdf");

  if (!fileId) {
    const files = await listUniqueFinalPdfs(
      supabase,
      ctx.tenant.id,
      orderRef,
      skus
    );
    return NextResponse.json({
      files: files.map((f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
      })),
    });
  }

  const allowed = await isRespondFinalPdfForOrder(
    supabase,
    ctx.tenant.id,
    orderRef,
    skus,
    fileId
  );
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
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    console.error("[final-artwork]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
