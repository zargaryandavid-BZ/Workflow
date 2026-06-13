import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeSkus } from "@/lib/skus";

const BUCKET = "order-assets";
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;
const PULSE_ORIGIN = "https://pulse-jade-five.vercel.app";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": PULSE_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonWithCors(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface AssetRow {
  id: string;
  order_id: string;
  sku_key: string | null;
  storage_path: string | null;
  external_url: string | null;
}

async function resolveArtworkUrl(
  asset: AssetRow,
  admin: ReturnType<typeof createAdminClient>
): Promise<string | null> {
  const external = asset.external_url?.trim();
  if (external) return external;

  const path = asset.storage_path?.trim();
  if (!path) return null;

  const { data: signed, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);

  if (error || !signed) return null;
  return signed.signedUrl;
}

export async function GET(request: NextRequest) {
  const orderRef = request.nextUrl.searchParams.get("order_ref")?.trim();

  if (!orderRef) {
    return jsonWithCors({ error: "order_ref is required" }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return jsonWithCors({ error: "Server error" }, { status: 500 });
  }

  // Order numbers are stored in `orders.title` (e.g. ORD-2026-004-1).
  const { data: orders, error: orderError } = await admin
    .from("orders")
    .select("id, title, specs")
    .or(`title.eq.${orderRef},title.like.${orderRef}-%`);

  if (orderError) {
    return jsonWithCors({ error: "Failed to fetch order" }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return jsonWithCors({ error: "Order not found" }, { status: 404 });
  }

  const orderIds = orders.map((o) => o.id as string);

  const { data: assetRows, error: assetError } = await admin
    .from("assets")
    .select("id, order_id, sku_key, storage_path, external_url")
    .in("order_id", orderIds)
    .not("sku_key", "is", null);

  if (assetError) {
    return jsonWithCors({ error: "Failed to fetch artwork" }, { status: 500 });
  }

  const assetsByOrderSku = new Map<string, AssetRow>();
  for (const row of (assetRows ?? []) as AssetRow[]) {
    if (!row.sku_key) continue;
    assetsByOrderSku.set(`${row.order_id}:${row.sku_key}`, row);
  }

  const result = await Promise.all(
    orders.map(async (order) => {
      const orderId = order.id as string;
      const specs = order.specs as Record<string, unknown> | null;
      const skus = normalizeSkus(specs?.skus);
      const displayTitle =
        (typeof specs?.webhook_item_title === "string"
          ? specs.webhook_item_title.trim()
          : "") || (order.title as string);

      const skusWithArtwork = await Promise.all(
        skus.map(async (sku) => {
          const asset = assetsByOrderSku.get(`${orderId}:${sku.id}`);
          const artworkUrl = asset ? await resolveArtworkUrl(asset, admin) : null;

          return {
            sku_id: sku.id,
            order_id: orderId,
            sku_name: sku.name,
            quantity: sku.qty,
            artwork_url: artworkUrl,
          };
        })
      );

      return {
        order_id: orderId,
        order_number: order.title as string,
        title: displayTitle,
        skus: skusWithArtwork,
      };
    })
  );

  return jsonWithCors({
    success: true,
    order_ref: orderRef,
    orders: result,
  });
}
