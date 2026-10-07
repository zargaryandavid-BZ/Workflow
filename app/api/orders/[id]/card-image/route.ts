import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { canEditOrderDetails } from "@/lib/permissions";
import { preserveCardImage, type CardImageSource } from "@/lib/card-image";
import { loadOrderFinalDriveContext, collectGroupDriveSeedIds } from "@/lib/order-gdrive";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Build or return the cardboard picture from the Final production PDF. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const loaded = await loadOrderFinalDriveContext(
    supabase,
    ctx.tenant.id,
    orderId
  );
  if (loaded.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const {
    loadProductionCardPreviewUrl,
    ensureBoardCardThumbnailFromFinalPdf,
  } = await import("@/lib/approval-layer-previews");

  const existing = await loadProductionCardPreviewUrl(orderId);
  if (existing) {
    return NextResponse.json({ ...existing, source: "sku_image" as const });
  }

  if (loaded.kind !== "ok") {
    return NextResponse.json({ error: "No production PDF" }, { status: 404 });
  }

  const groupFolderIds = await collectGroupDriveSeedIds(
    supabase,
    ctx.tenant.id,
    {
      id: loaded.order.id,
      title: loaded.order.title,
      specs: loaded.order.specs,
    }
  );
  const folderIds = [
    ...new Set(
      [
        ...(loaded.resolved?.finalIds ?? []),
        ...loaded.seedIds,
        ...groupFolderIds,
      ].filter(Boolean)
    ),
  ];
  if (folderIds.length === 0) {
    return NextResponse.json({ error: "No production PDF" }, { status: 404 });
  }

  const preview = await ensureBoardCardThumbnailFromFinalPdf(
    {
      id: loaded.order.id,
      title: loaded.order.title,
      tenant_id: ctx.tenant.id,
      specs: loaded.order.specs,
    },
    loaded.settings,
    folderIds
  );
  if (!preview) {
    return NextResponse.json(
      { error: "Could not build card picture from the Final PDF" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ...preview, source: "sku_image" as const });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    id?: unknown;
  };
  const source = body.source;
  const imageId = typeof body.id === "string" ? body.id.trim() : "";
  if (
    (source !== "sku_image" && source !== "asset") ||
    !imageId
  ) {
    return NextResponse.json(
      { error: "source and id are required" },
      { status: 400 }
    );
  }
  const cardSource = source as CardImageSource;

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, specs, webhook_source")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canEditOrderDetails(ctx.role, order)) {
    return NextResponse.json(
      { error: "You don’t have permission to change the card picture." },
      { status: 403 }
    );
  }

  if (cardSource === "sku_image") {
    const { data: img } = await supabase
      .from("order_sku_images")
      .select("id")
      .eq("id", imageId)
      .eq("order_id", orderId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!img) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
  } else {
    const { data: asset } = await supabase
      .from("assets")
      .select("id")
      .eq("id", imageId)
      .eq("order_id", orderId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!asset) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
  }

  const existingSpecs =
    (order.specs as Record<string, unknown> | null) ?? {};
  const nextSpecs = preserveCardImage(existingSpecs, {
    ...existingSpecs,
    card_image: { source: cardSource, id: imageId },
  });

  const { error } = await supabase
    .from("orders")
    .update({ specs: nextSpecs })
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
