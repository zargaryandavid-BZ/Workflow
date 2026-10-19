import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { canEditOrderDetails } from "@/lib/permissions";
import { preserveCardImage, type CardImageSource } from "@/lib/card-image";
import { loadOrderFinalDriveContext } from "@/lib/order-gdrive";
import { cacheGet, cacheSet } from "@/lib/cache";

// When a card has no buildable picture, every board load re-ran the full
// "build picture from the Final PDF" attempt (~4s each, ~20 cards). Remember
// that miss for 10 min, keyed by the order's Final folders AND its card_pdf_rev,
// so a new folder or a regenerated card picture skips the remembered miss.
// A Drive refresh (gdrive-status?refresh=1) also clears it.
const CARD_MISS_TTL_SECONDS = 10 * 60;
const cardImageMissKey = (tenantId: string, orderId: string) =>
  `wf:card-image-miss:v1:${tenantId}:${orderId}`;

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
  // Own line item's folder only — never the whole order group's folders, or a
  // sibling line item's newest file bleeds onto this card.
  const loaded = await loadOrderFinalDriveContext(
    supabase,
    ctx.tenant.id,
    orderId,
    { includeGroupSeeds: false }
  );
  if (loaded.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const {
    loadProductionCardPreviewUrl,
    ensureBoardCardThumbnailFromFinalPdf,
  } = await import("@/lib/approval-layer-previews");

  const existing = await loadProductionCardPreviewUrl(orderId);

  if (loaded.kind !== "ok") {
    if (existing) {
      return NextResponse.json({ ...existing, source: "sku_image" as const });
    }
    return NextResponse.json({ error: "No production PDF" }, { status: 404 });
  }

  const folderIds = [
    ...new Set(
      [...(loaded.resolved?.finalIds ?? []), ...loaded.seedIds].filter(Boolean)
    ),
  ];
  if (folderIds.length === 0) {
    if (existing) {
      return NextResponse.json({ ...existing, source: "sku_image" as const });
    }
    return NextResponse.json({ error: "No production PDF" }, { status: 404 });
  }

  const specs = (loaded.order.specs ?? {}) as Record<string, unknown>;
  const missFingerprint = `${[...folderIds].sort().join(",")}|${
    typeof specs.card_pdf_rev === "string" ? specs.card_pdf_rev : ""
  }`;
  const missKey = cardImageMissKey(ctx.tenant.id, orderId);
  if ((await cacheGet<string>(missKey)) === missFingerprint) {
    if (existing) {
      return NextResponse.json({ ...existing, source: "sku_image" as const });
    }
    return NextResponse.json(
      { error: "Could not build card picture from the Final PDF" },
      { status: 404 }
    );
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
  if (preview) {
    return NextResponse.json({ ...preview, source: "sku_image" as const });
  }
  await cacheSet(missKey, missFingerprint, CARD_MISS_TTL_SECONDS);
  if (existing) {
    return NextResponse.json({ ...existing, source: "sku_image" as const });
  }
  return NextResponse.json(
    { error: "Could not build card picture from the Final PDF" },
    { status: 404 }
  );
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
