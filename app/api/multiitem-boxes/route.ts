import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";
import {
  multiitemBoxNameFromIsoDate,
  utcBoxDate,
} from "@/lib/fulfillment-day";
import type { MultiitemBoxRow } from "@/lib/multiitem-box-lookup";
import {
  normalizeMultiitemBoxSkuLines,
  resolveStoredBoxSkuLines,
} from "@/lib/multiitem-box-lookup";
import { skuQtySumFromSpecs } from "@/lib/skus";
import { boxOrderThumbnailUrls } from "@/lib/multiitem-box-artwork";
import { loadFinalArtworkSkuCount } from "@/lib/final-artwork-sku-count";

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

  const repairs: {
    boxId: string;
    orderId: string;
    skuLines: ReturnType<typeof resolveStoredBoxSkuLines>;
    quantity: number;
  }[] = [];

  const boxes = rawBoxes.map((box) => ({
    ...box,
    box_name: multiitemBoxNameFromIsoDate(box.box_number, box.box_date),
    multiitem_box_orders: [...(box.multiitem_box_orders ?? [])]
      .sort((a, b) => a.added_at.localeCompare(b.added_at))
      .map((row) => ({
        ...row,
        sku_lines: (() => {
          const specs = specsByOrderId.get(row.order_id);
          const ticketTotal = skuQtySumFromSpecs(specs);
          const stored = normalizeMultiitemBoxSkuLines(row.sku_lines);
          const lines = resolveStoredBoxSkuLines({
            stored,
            specs,
            totalQty: ticketTotal > 0 ? ticketTotal : row.quantity,
            skuCount: skuCountByOrderId.get(row.order_id),
          });
          const changed =
            lines.length !== stored.length ||
            lines.some(
              (line, index) =>
                line.page !== stored[index]?.page ||
                line.label !== stored[index]?.label ||
                line.quantity !== stored[index]?.quantity
            );
          if (changed && lines.length > 0 && box.status === "open") {
            const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
            repairs.push({
              boxId: box.id,
              orderId: row.order_id,
              skuLines: lines,
              quantity,
            });
            return lines;
          }
          return stored.length > 0 ? stored : lines;
        })(),
        customer_email: contactByOrderId.get(row.order_id)?.email ?? null,
        customer_phone: contactByOrderId.get(row.order_id)?.phone ?? null,
        thumbnail_url: thumbByOrder.get(row.order_id) ?? null,
      })),
  }));

  if (repairs.length > 0) {
    await Promise.all(
      repairs.map((repair) =>
        supabase
          .from("multiitem_box_orders")
          .update({
            sku_lines: repair.skuLines,
            quantity: repair.quantity,
          })
          .eq("box_id", repair.boxId)
          .eq("order_id", repair.orderId)
          .eq("tenant_id", tenantId)
      )
    );
  }

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
