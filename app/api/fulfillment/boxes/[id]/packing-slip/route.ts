import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { orderCardThumbnails } from "@/lib/board-order-enrichment";
import { firstThumbnailUrl } from "@/lib/card-image";
import { createClient } from "@/lib/supabase/server";
import { generateFulfillmentBoxSlipPdf } from "@/lib/fulfillment-box-slip-pdf";
import { fulfillmentBoxLabel, fulfillmentDateTimeLabel } from "@/lib/fulfillment-day";
import { fulfillmentDisplayQty } from "@/lib/fulfillment-expected-qty";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";

export const runtime = "nodejs";
export const maxDuration = 60;

function joinedOrder(raw: unknown): {
  title: string;
  specs: Record<string, unknown> | null;
} | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const rec = row as { title?: unknown; specs?: unknown };
  if (typeof rec.title !== "string") return null;
  const specs =
    rec.specs && typeof rec.specs === "object"
      ? (rec.specs as Record<string, unknown>)
      : null;
  return { title: rec.title, specs };
}

async function fetchSlipImage(url: string | undefined): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const { id: boxId } = await params;
  const supabase = await createClient();

  const { data: box, error: boxError } = await supabase
    .from("fulfillment_boxes")
    .select("id, box_number, created_at, sent_at, received_at")
    .eq("id", boxId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (boxError || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }

  const { data: rows, error: ordersError } = await supabase
    .from("fulfillment_box_orders")
    .select(
      `
      order_id,
      quantity_expected,
      orders (
        title,
        specs
      )
    `
    )
    .eq("box_id", boxId)
    .eq("tenant_id", ctx.tenant.id);

  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }

  let items = (rows ?? [])
    .map((row) => {
      const order = joinedOrder(row.orders);
      if (!order) return null;
      return {
        orderId: row.order_id as string,
        orderNumber: formatShortOrderNumber(order.title),
        qty: fulfillmentDisplayQty(row.quantity_expected, order.specs),
        specs: order.specs,
      };
    })
    .filter(
      (
        row
      ): row is {
        orderId: string;
        orderNumber: string;
        qty: number;
        specs: Record<string, unknown> | null;
      } => row != null
    );

  const missingIds = (rows ?? [])
    .map((row) => row.order_id as string)
    .filter((id) => id && !items.some((item) => item.orderId === id));

  if (missingIds.length > 0) {
    const { data: extra } = await supabase
      .from("orders")
      .select("id, title, specs")
      .eq("tenant_id", ctx.tenant.id)
      .in("id", missingIds);
    const qtyByOrder = new Map(
      (rows ?? []).map((row) => [
        row.order_id as string,
        row.quantity_expected as number | null,
      ])
    );
    for (const order of extra ?? []) {
      items.push({
        orderId: order.id as string,
        orderNumber: formatShortOrderNumber(String(order.title ?? "")),
        qty: fulfillmentDisplayQty(
          qtyByOrder.get(order.id as string) ?? null,
          (order.specs as Record<string, unknown> | null) ?? null
        ),
        specs: (order.specs as Record<string, unknown> | null) ?? null,
      });
    }
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "This box has no orders to print" },
      { status: 400 }
    );
  }

  const thumbs = await orderCardThumbnails(
    supabase,
    items.map((item) => ({ id: item.orderId, specs: item.specs }))
  );
  const slipItems = await Promise.all(
    items.map(async (item) => ({
      orderNumber: item.orderNumber,
      qty: item.qty,
      image: await fetchSlipImage(firstThumbnailUrl(thumbs[item.orderId])),
    }))
  );

  const deliveryDate = box.sent_at
    ? fulfillmentDateTimeLabel(box.sent_at)
    : "Not sent yet";

  const pdf = await generateFulfillmentBoxSlipPdf({
    boxId: box.id,
    boxLabel: fulfillmentBoxLabel(box),
    deliveryDate,
    items: slipItems,
  });

  const name = fulfillmentBoxLabel(box).replace(/[^\w.-]/g, "_");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="box-slip-${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
