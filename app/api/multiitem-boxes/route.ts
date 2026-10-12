import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import {
  multiitemBoxNameFromIsoDate,
  utcBoxDate,
} from "@/lib/fulfillment-day";
import type { MultiitemBoxRow } from "@/lib/multiitem-box-lookup";
import { normalizeMultiitemBoxSkuLines } from "@/lib/multiitem-box-lookup";
import { createClient } from "@/lib/supabase/server";
import { boxOrderThumbnailUrls } from "@/lib/multiitem-box-artwork";
import { loadFinalArtworkSkuCount } from "@/lib/final-artwork-sku-count";
import { scanQtyPerSkuFromSpecs } from "@/lib/fulfillment-scan-order";

export async function GET(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const status = new URL(request.url).searchParams.get("status") ?? "open";
  if (status !== "open" && status !== "saved") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const supabase = await createClient();
  const today = utcBoxDate();

  let query = supabase
    .from("multiitem_boxes")
    .select(
      "id, box_name, box_number, box_date, po_number, size_label, weight_lbs, customer_id, customer_name, customer_email, customer_phone, status, created_at, saved_at, multiitem_box_orders(*)"
    )
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", status)
    .order(status === "saved" ? "saved_at" : "created_at", {
      ascending: false,
    });

  if (status === "open") {
    query = query.eq("box_date", today);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rawBoxes = (data ?? []) as MultiitemBoxRow[];
  const orderIds = [
    ...new Set(
      rawBoxes.flatMap((box) =>
        (box.multiitem_box_orders ?? []).map((row) => row.order_id)
      )
    ),
  ];
  const contactByOrderId = new Map<
    string,
    { email: string | null; phone: string | null }
  >();
  const specsByOrderId = new Map<string, Record<string, unknown>>();

  if (orderIds.length > 0) {
    const { data: orders } = await supabase
      .from("orders")
      .select("id, specs, customer:customers(email, phone)")
      .eq("tenant_id", ctx.tenant.id)
      .in("id", orderIds);

    for (const order of (orders ?? []) as {
      id: string;
      specs: Record<string, unknown> | null;
      customer:
        | { email: string | null; phone: string | null }
        | { email: string | null; phone: string | null }[]
        | null;
    }[]) {
      const customer = Array.isArray(order.customer)
        ? order.customer[0]
        : order.customer;
      contactByOrderId.set(order.id, {
        email: customer?.email ?? null,
        phone: customer?.phone ?? null,
      });
      specsByOrderId.set(order.id, order.specs ?? {});
    }
  }

  const [thumbByOrder, skuCountPairs] = await Promise.all([
    boxOrderThumbnailUrls(supabase, orderIds),
    Promise.all(
      orderIds.map(async (orderId) => [
        orderId,
        await loadFinalArtworkSkuCount(orderId),
      ] as const)
    ),
  ]);
  const skuCountByOrderId = new Map(skuCountPairs);

  const boxes = rawBoxes.map((box) => ({
    ...box,
    multiitem_box_orders: [...(box.multiitem_box_orders ?? [])]
      .sort((a, b) => a.added_at.localeCompare(b.added_at))
      .map((row) => ({
        ...row,
        sku_lines: (() => {
          const stored = normalizeMultiitemBoxSkuLines(row.sku_lines);
          if (stored.length > 0) return stored;
          const count = skuCountByOrderId.get(row.order_id) ?? 0;
          if (count < 1) return [];
          const explicit = scanQtyPerSkuFromSpecs(
            specsByOrderId.get(row.order_id),
            count
          );
          const divided =
            row.quantity > 0 && row.quantity % count === 0
              ? row.quantity / count
              : 0;
          const quantity = explicit ?? divided;
          if (quantity < 1) return [];
          return Array.from({ length: count }, (_, index) => ({
            page: index + 1,
            label: `SKU ${index + 1}`,
            quantity,
          }));
        })(),
        customer_email: contactByOrderId.get(row.order_id)?.email ?? null,
        customer_phone: contactByOrderId.get(row.order_id)?.phone ?? null,
        thumbnail_url: thumbByOrder.get(row.order_id) ?? null,
      })),
  }));

  return NextResponse.json({ boxes });
}

export async function POST(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const body = (await request.json().catch(() => ({}))) as {
    po_number?: string;
    size_label?: string;
    weight_lbs?: number | string | null;
  };

  const supabase = await createClient();
  const boxDate = utcBoxDate();

  const { data: latestBox, error: numberError } = await supabase
    .from("multiitem_boxes")
    .select("box_number")
    .eq("tenant_id", ctx.tenant.id)
    .eq("box_date", boxDate)
    .order("box_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (numberError) {
    return NextResponse.json({ error: numberError.message }, { status: 500 });
  }

  const boxNumber = Math.max(0, Number(latestBox?.box_number) || 0) + 1;
  const boxName = multiitemBoxNameFromIsoDate(boxNumber, boxDate);
  const weightRaw = body.weight_lbs;
  const weight =
    weightRaw == null || weightRaw === ""
      ? null
      : Number(weightRaw);

  const { data, error } = await supabase
    .from("multiitem_boxes")
    .insert({
      tenant_id: ctx.tenant.id,
      box_name: boxName,
      box_number: boxNumber,
      box_date: boxDate,
      po_number: body.po_number?.trim() || null,
      size_label: body.size_label?.trim() || null,
      weight_lbs:
        weight != null && Number.isFinite(weight) ? weight : null,
      status: "open",
      created_by: ctx.userId,
    })
    .select(
      "id, box_name, box_number, box_date, po_number, size_label, weight_lbs, customer_id, customer_name, customer_email, customer_phone, status, created_at, saved_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { box: { ...data, multiitem_box_orders: [] } },
    { status: 201 }
  );
}
