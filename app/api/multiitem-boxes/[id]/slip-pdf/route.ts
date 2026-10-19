import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";
import { generateMultiitemBoxSlipPdf } from "@/lib/multiitem-box-slip-pdf";
import { loadFinalArtworkSkuCount } from "@/lib/final-artwork-sku-count";
import { scanQtyPerSkuFromSpecs } from "@/lib/fulfillment-scan-order";
import { normalizeMultiitemBoxSkuLines } from "@/lib/multiitem-box-lookup";
import { multiitemBoxNameFromIsoDate } from "@/lib/fulfillment-day";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;
  const { id: boxId } = await params;
  const positiveInt = (value: unknown): number | null => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && number <= 10_000
      ? number
      : null;
  };
  let printInfo: Record<string, unknown> = {};
  try {
    printInfo = (await request.json()) as Record<string, unknown>;
  } catch {
    // A single-box print can omit shipment metadata.
  }

  const { data: box, error: boxError } = await supabase
    .from("multiitem_boxes")
    .select(
      "id, box_name, box_number, box_date, po_number, size_label, weight_lbs, customer_name, customer_email, customer_phone, multiitem_box_orders(*)"
    )
    .eq("id", boxId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (boxError || !box) {
    return NextResponse.json({ error: "Box not found" }, { status: 404 });
  }

  const items = [...(box.multiitem_box_orders ?? [])].sort((a, b) =>
    String(a.added_at).localeCompare(String(b.added_at))
  );
  const orderIds = [
    ...new Set(items.map((item) => item.order_id as string).filter(Boolean)),
  ];
  const { data: orders } =
    orderIds.length > 0
      ? await supabase
          .from("orders")
          .select("id, specs")
          .eq("tenant_id", tenantId)
          .in("id", orderIds)
      : { data: [] };
  const specsByOrderId = new Map(
    (orders ?? []).map((order) => [
      order.id as string,
      (order.specs ?? {}) as Record<string, unknown>,
    ])
  );
  const skuCountByOrderId = new Map(
    await Promise.all(
      orderIds.map(async (orderId) => [
        orderId,
        await loadFinalArtworkSkuCount(orderId),
      ] as const)
    )
  );

  const distinctCustomers = [...new Set(
    items.map(i => (i.customer_name as string | null)?.trim()).filter(Boolean)
  )];
  const multipleCustomers = distinctCustomers.length > 1;

  const pdf = await generateMultiitemBoxSlipPdf({
    boxName: multiitemBoxNameFromIsoDate(box.box_number, box.box_date),
    poNumber: box.po_number,
    sizeLabel: box.size_label,
    weightLbs:
      box.weight_lbs == null ? null : Number(box.weight_lbs),
    shipmentBoxNumber: positiveInt(printInfo.shipmentBoxNumber),
    shipmentBoxCount: positiveInt(printInfo.shipmentBoxCount),
    palletNumber: positiveInt(printInfo.palletNumber),
    palletCount: positiveInt(printInfo.palletCount),
    palletBoxNumber: positiveInt(printInfo.palletBoxNumber),
    palletBoxCount: positiveInt(printInfo.palletBoxCount),
    customerName: multipleCustomers ? "Multiple Customers" : (box.customer_name ?? distinctCustomers[0] ?? null),
    customerEmail: multipleCustomers ? null : (box.customer_email ?? null),
    customerPhone: multipleCustomers ? null : (box.customer_phone ?? null),
    printedAt: new Date(),
    items: items.map((row) => ({
      orderTitle: row.order_title,
      itemTitle: row.item_title ?? "",
      quantity: row.quantity,
      skuLines: (() => {
        const stored = normalizeMultiitemBoxSkuLines(row.sku_lines);
        if (stored.length > 0) return stored;
        const count = skuCountByOrderId.get(row.order_id as string) ?? 0;
        if (count < 1) return [];
        const explicit = scanQtyPerSkuFromSpecs(
          specsByOrderId.get(row.order_id as string),
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
    })),
  });

  const safeName = box.box_name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="box-slip-${safeName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
