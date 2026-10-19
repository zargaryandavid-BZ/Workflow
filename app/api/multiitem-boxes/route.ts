import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";
import {
  multiitemBoxNameFromIsoDate,
  utcBoxDate,
} from "@/lib/fulfillment-day";
import type { MultiitemBoxRow } from "@/lib/multiitem-box-lookup";
import { normalizeMultiitemBoxSkuLines } from "@/lib/multiitem-box-lookup";
import { boxOrderThumbnailUrls } from "@/lib/multiitem-box-artwork";
import { loadFinalArtworkSkuCount } from "@/lib/final-artwork-sku-count";
import { scanQtyPerSkuFromSpecs } from "@/lib/fulfillment-scan-order";

export async function GET(request: Request) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;

  const searchParams = new URL(request.url).searchParams;
  const status = searchParams.get("status") ?? "open";
  if (status !== "open" && status !== "saved") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  let query = supabase
    .from("multiitem_boxes")
    .select(
      "id, box_name, box_number, box_date, po_number, size_label, weight_lbs, customer_id, customer_name, customer_email, customer_phone, status, created_at, saved_at, multiitem_box_orders(*)"
    )
    .eq("tenant_id", tenantId)
    .eq("status", status)
    .order(status === "saved" ? "saved_at" : "created_at", {
      // Open boxes form a left-to-right working row, so newly created boxes
      // must append on the right. Saved history remains newest-first.
      ascending: status === "open",
    });

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
      .eq("tenant_id", tenantId)
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
    box_name: multiitemBoxNameFromIsoDate(box.box_number, box.box_date),
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
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId, userId } = access;

  const body = (await request.json().catch(() => ({}))) as {
    box_date?: string;
    po_number?: string;
    size_label?: string;
    weight_lbs?: number | string | null;
  };

  const boxDate =
    typeof body.box_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.box_date)
      ? body.box_date
      : utcBoxDate();
  const weightRaw = body.weight_lbs;
  const weight =
    weightRaw == null || weightRaw === ""
      ? null
      : Number(weightRaw);
  const insertRow = {
    tenant_id: tenantId,
    box_date: boxDate,
    po_number: body.po_number?.trim() || null,
    size_label: body.size_label?.trim() || null,
    weight_lbs: weight != null && Number.isFinite(weight) ? weight : null,
    status: "open" as const,
    created_by: userId,
  };
  const selectCols =
    "id, box_name, box_number, box_date, po_number, size_label, weight_lbs, customer_id, customer_name, customer_email, customer_phone, status, created_at, saved_at";

  async function nextBoxNumber(): Promise<number | { error: string }> {
    const { data: rows, error } = await supabase
      .from("multiitem_boxes")
      .select("box_number")
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };
    const max = (rows ?? []).reduce(
      (n, row) => Math.max(n, Number(row.box_number) || 0),
      0
    );
    return max + 1;
  }

  let data: Record<string, unknown> | null = null;
  let lastError: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const next = await nextBoxNumber();
    if (typeof next !== "number") {
      return NextResponse.json({ error: next.error }, { status: 500 });
    }
    const boxNumber = next;
    const inserted = await supabase
      .from("multiitem_boxes")
      .insert({
        ...insertRow,
        box_name: multiitemBoxNameFromIsoDate(boxNumber, boxDate),
        box_number: boxNumber,
      })
      .select(selectCols)
      .single();
    if (!inserted.error && inserted.data) {
      data = inserted.data;
      lastError = null;
      break;
    }
    lastError = inserted.error;
    if (inserted.error?.code !== "23505") {
      return NextResponse.json(
        { error: inserted.error.message },
        { status: 500 }
      );
    }
  }

  if (!data || lastError) {
    return NextResponse.json(
      { error: lastError?.message ?? "Failed to create box" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { box: { ...data, multiitem_box_orders: [] } },
    { status: 201 }
  );
}
