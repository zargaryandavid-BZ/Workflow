import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { canEditOrderDetails } from "@/lib/permissions";
import { preserveCardImage, type CardImageSource } from "@/lib/card-image";
import { loadOrderFinalDriveContext } from "@/lib/order-gdrive";
import { cacheGet, cacheInvalidate, cacheSet, swrGet, swrSet } from "@/lib/cache";
import { cardImageMissKey, cardImageRespKey } from "@/lib/board-cache-keys";

// When a card has no buildable picture, every board load re-ran the full
// "build picture from the Final PDF" attempt (~4s each, ~20 cards). Remember
// that miss for 10 min, keyed by the order's Final folders AND its card_pdf_rev,
// so a new folder or a regenerated card picture skips the remembered miss.
// A Drive refresh (gdrive-status?refresh=1) also clears it.
const CARD_MISS_TTL_SECONDS = 10 * 60;


// Whole-answer cache: every board load asked each picture-less card again and
// each answer took ~1s even when nothing changed (folder lookup + image lookup).
// The answer is remembered 10 min per order AND per card_pdf_rev, so a
// regenerated picture (new rev) is picked up at once; choosing a picture
// (POST below) or a Drive refresh clears it. Signed image links last 1 hour,
// longer than this cache.
// Hayk 2026-11-26: kept a day, shown at once; after 10 min the next board open
// rebuilds it in the background (stale-while-revalidate). A new card_pdf_rev
// still forces a fresh answer right away.
const CARD_RESPONSE_FRESH_SECONDS = 10 * 60;
const cardResponseKey = cardImageRespKey;
/** Signed picture links last 1 hour; re-sign saved ones older than 50 min. */
const SIGNED_LINK_SAFE_SECONDS = 50 * 60;
type CachedCardResponse = { rev: string; status: number; body: Record<string, unknown> };

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
  const { data: revRow } = await supabase
    .from("orders")
    .select("specs")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  const revSpecs = ((revRow?.specs ?? {}) as Record<string, unknown>);
  const rev = typeof revSpecs.card_pdf_rev === "string" ? revSpecs.card_pdf_rev : "";
  const respKey = cardResponseKey(ctx.tenant.id, orderId);
  const saved = revRow ? await swrGet<CachedCardResponse>(respKey) : null;
  if (saved && saved.value.rev === rev) {
    if (saved.value.status === 200 && saved.ageSeconds > SIGNED_LINK_SAFE_SECONDS) {
      // Picture links are signed for 1 hour: give an older saved picture a
      // fresh link (one quick lookup) instead of a full rebuild from Drive.
      const { loadProductionCardPreviewUrl } = await import(
        "@/lib/approval-layer-previews"
      );
      const fresh = await loadProductionCardPreviewUrl(orderId).catch(() => null);
      if (fresh) {
        const body = { ...saved.value.body, ...fresh };
        await swrSet<CachedCardResponse>(respKey, { rev, status: 200, body });
        return NextResponse.json(body, { status: 200 });
      }
      // No stored picture any more → rebuild below.
    } else {
      if (saved.ageSeconds > CARD_RESPONSE_FRESH_SECONDS) {
        const tenantId = ctx.tenant.id;
        try {
          after(() =>
            buildAndSaveCardImage(supabase, tenantId, orderId, rev).catch(
              () => undefined
            )
          );
        } catch {
          // after() unavailable outside a request — skip the refresh
        }
      }
      return NextResponse.json(saved.value.body, { status: saved.value.status });
    }
  }

  const res = revRow
    ? await buildAndSaveCardImage(supabase, ctx.tenant.id, orderId, rev)
    : await buildCardImageResponse(supabase, ctx.tenant.id, orderId);
  return NextResponse.json(res.body, { status: res.status });
}

/** Build the card-picture answer and save it (found / no picture only). */
async function buildAndSaveCardImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  orderId: string,
  rev: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await buildCardImageResponse(supabase, tenantId, orderId);
  if (res.status === 200 || res.status === 404) {
    await swrSet<CachedCardResponse>(cardResponseKey(tenantId, orderId), {
      rev,
      status: res.status,
      body: res.body,
    });
  }
  return res;
}

async function buildCardImageResponse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  orderId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctx = { tenant: { id: tenantId } };
  // Own line item's folder only — never the whole order group's folders, or a
  // sibling line item's newest file bleeds onto this card.
  const loaded = await loadOrderFinalDriveContext(
    supabase,
    ctx.tenant.id,
    orderId,
    { includeGroupSeeds: false }
  );
  if (loaded.kind === "not_found") {
    return { status: 404, body: { error: "Not found" } };
  }

  const {
    loadProductionCardPreviewUrl,
    ensureBoardCardThumbnailFromFinalPdf,
  } = await import("@/lib/approval-layer-previews");

  const existing = await loadProductionCardPreviewUrl(orderId);

  if (loaded.kind !== "ok") {
    if (existing) {
      return { status: 200, body: { ...existing, source: "sku_image" } };
    }
    return { status: 404, body: { error: "No production PDF" } };
  }

  const folderIds = [
    ...new Set(
      [...(loaded.resolved?.finalIds ?? []), ...loaded.seedIds].filter(Boolean)
    ),
  ];
  if (folderIds.length === 0) {
    if (existing) {
      return { status: 200, body: { ...existing, source: "sku_image" } };
    }
    return { status: 404, body: { error: "No production PDF" } };
  }

  const specs = (loaded.order.specs ?? {}) as Record<string, unknown>;
  const missFingerprint = `${[...folderIds].sort().join(",")}|${
    typeof specs.card_pdf_rev === "string" ? specs.card_pdf_rev : ""
  }`;
  const missKey = cardImageMissKey(ctx.tenant.id, orderId);
  if ((await cacheGet<string>(missKey)) === missFingerprint) {
    if (existing) {
      return { status: 200, body: { ...existing, source: "sku_image" } };
    }
    return { status: 404, body: { error: "Could not build card picture from the Final PDF" } };
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
    return { status: 200, body: { ...preview, source: "sku_image" } };
  }
  await cacheSet(missKey, missFingerprint, CARD_MISS_TTL_SECONDS);
  if (existing) {
    return { status: 200, body: { ...existing, source: "sku_image" } };
  }
  return { status: 404, body: { error: "Could not build card picture from the Final PDF" } };
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

  await cacheInvalidate(cardResponseKey(ctx.tenant.id, orderId));
  return NextResponse.json({ success: true });
}
