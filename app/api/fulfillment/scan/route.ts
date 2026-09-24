import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { requireFulfillmentApi } from "@/lib/fulfillment-access";
import { createClient } from "@/lib/supabase/server";
import {
  buildScanCardDisplay,
  nestedCustomer,
  parseScanQuery,
  pickScannedOrder,
  sanitizeScanLookupToken,
  scanDesignerNameFromSpecs,
  scanOwnerNameFromSpecs,
  scanPartLocationsFromMembers,
} from "@/lib/fulfillment-scan-order";
import { normalizeSkus } from "@/lib/skus";
import { assembleSkuMainPictures } from "@/lib/sku-main-pictures";
import { formatShortOrderNumber } from "@/lib/order-number-tokens";
import { listOrderGroupMembers } from "@/lib/ready-to-ship-group";

/**
 * GET /api/fulfillment/scan?q=ORDER_NUMBER
 *
 * Looks up an order by QR/order number and returns board-card data:
 * customer, thumbnail, print specs, due label, billing, owner, designer.
 */
export async function GET(request: Request) {
  const auth = requireFulfillmentApi(await getTenantContext());
  if ("error" in auth) return auth.error;
  const { ctx } = auth;

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const scanned = parseScanQuery(q);
  const lookupToken = scanned.lookupToken || sanitizeScanLookupToken(q);
  if (!lookupToken) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const supabase = await createClient();

  const orderSelect =
    "id, title, specs, due_date, column_id, customer_id, created_by, customer:customers(id, name, email, phone)";

  const { data: exactRows, error: exactError } = await supabase
    .from("orders")
    .select(orderSelect)
    .eq("tenant_id", ctx.tenant.id)
    .is("removed_at", null)
    .or(
      `title.eq.${lookupToken},specs->>webhook_order_number.eq.${lookupToken}`
    );

  if (exactError) {
    return NextResponse.json({ error: exactError.message }, { status: 500 });
  }

  let order = pickScannedOrder(exactRows ?? [], q);

  if (!order) {
    const { data: fuzzyRows, error: fuzzyError } = await supabase
      .from("orders")
      .select(orderSelect)
      .eq("tenant_id", ctx.tenant.id)
      .is("removed_at", null)
      .or(
        `title.ilike.%${lookupToken}%,specs->>webhook_order_number.ilike.%${lookupToken}%`
      )
      .limit(40);

    if (fuzzyError) {
      return NextResponse.json({ error: fuzzyError.message }, { status: 500 });
    }
    order = pickScannedOrder(fuzzyRows ?? [], q);
  }

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const designerId =
    typeof specs.designer_id === "string" ? specs.designer_id.trim() : "";
  const createdBy =
    typeof (order as { created_by?: unknown }).created_by === "string"
      ? ((order as { created_by: string }).created_by)
      : "";

  const profileIds = [...new Set([createdBy, designerId].filter(Boolean))];

  const [skuImagesRes, columnsRes, fieldsRes, valuesRes, profilesRes, shippingRes, lastSmsRes, members] =
    await Promise.all([
      supabase
        .from("order_sku_images")
        .select("id, sku_id, storage_path, position")
        .eq("order_id", order.id)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("board_columns")
        .select("id, name")
        .eq("tenant_id", ctx.tenant.id),
      supabase
        .from("custom_fields")
        .select("id, name")
        .eq("tenant_id", ctx.tenant.id),
      supabase
        .from("custom_field_values")
        .select("custom_field_id, value")
        .eq("order_id", order.id),
      profileIds.length > 0
        ? supabase
            .from("profiles")
            .select("id, full_name")
            .in("id", profileIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      supabase
        .from("shipping_requests")
        .select("id, token, client_choice, status")
        .eq("order_id", order.id)
        .eq("tenant_id", ctx.tenant.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("order_sms_messages")
        .select("created_at")
        .eq("order_id", order.id)
        .eq("tenant_id", ctx.tenant.id)
        .eq("direction", "outbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      listOrderGroupMembers(supabase, ctx.tenant.id, {
        id: order.id as string,
        title: String(order.title ?? ""),
        column_id: (order.column_id as string | null) ?? null,
        specs,
      }),
    ]);

  const skuImgRows = (skuImagesRes.data ?? []) as {
    id: string;
    sku_id: string;
    storage_path: string;
    position: number;
  }[];
  const pathsToSign = [
    ...new Set(
      skuImgRows.map((r) => r.storage_path).filter((p): p is string => Boolean(p))
    ),
  ];
  const signedMap = new Map<string, string>();
  if (pathsToSign.length > 0) {
    const { data: signed } = await supabase.storage
      .from("order-assets")
      .createSignedUrls(pathsToSign, 3600);
    for (const s of (signed ?? []) as { path: string | null; signedUrl: string }[]) {
      if (s.path) signedMap.set(s.path, s.signedUrl);
    }
  }
  const skuImages = assembleSkuMainPictures({
    skus: normalizeSkus(specs.skus),
    imageRows: skuImgRows,
    urlByPath: signedMap,
  });

  const fieldNameById = new Map(
    ((fieldsRes.data ?? []) as { id: string; name: string }[]).map((f) => [
      f.id,
      f.name,
    ])
  );
  const fieldValuesByName: Record<string, unknown> = {};
  for (const row of (valuesRes.data ?? []) as {
    custom_field_id: string;
    value: unknown;
  }[]) {
    const name = fieldNameById.get(row.custom_field_id);
    if (!name) continue;
    fieldValuesByName[name] = row.value;
  }

  const card = buildScanCardDisplay({
    specs,
    dueDate: (order as { due_date?: string | null }).due_date,
    fieldValuesByName,
  });

  const profiles = (profilesRes.data ?? []) as {
    id: string;
    full_name: string | null;
  }[];
  const profileName = (id: string) =>
    profiles.find((p) => p.id === id)?.full_name?.trim() || null;

  const columnNameById = new Map(
    ((columnsRes.data ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );
  const columnName = columnNameById.get(order.column_id as string) ?? null;
  const designerName =
    profileName(designerId) || scanDesignerNameFromSpecs(specs);
  const ownerName =
    profileName(createdBy) || scanOwnerNameFromSpecs(specs);

  const billing = specs.billing as
    | { deposit?: number | null; balance?: number | null }
    | null
    | undefined;

  const customer = nestedCustomer(
    (order as { customer?: unknown }).customer
  );

  const shippingRow = shippingRes.data as {
    id: string;
    token: string | null;
    client_choice: string | null;
    status: string | null;
  } | null;

  const groupParts = scanPartLocationsFromMembers(members, columnNameById);

  return NextResponse.json({
    id: order.id,
    title: order.title,
    order_number: scanned.orderNumber || formatShortOrderNumber(String(order.title ?? "")),
    main_item_count: groupParts.length || scanned.mainItemCount,
    group_parts: groupParts,
    due_date: (order as { due_date?: string | null }).due_date ?? null,
    due_display: card.dueDisplay,
    column_id: order.column_id,
    column_name: columnName,
    spec_lines: card.specLines,
    qty: card.qty,
    customer,
    thumbnail_url: skuImages[0]?.url ?? null,
    sku_images: skuImages,
    owner_name: ownerName,
    designer_name: designerName,
    billing: billing
      ? {
          deposit: billing.deposit ?? null,
          balance: billing.balance ?? null,
        }
      : null,
    shipping_request: shippingRow
      ? {
          token: shippingRow.token,
          client_choice: shippingRow.client_choice as "pickup" | "delivery" | "uber" | "curri" | null,
          status: shippingRow.status,
        }
      : null,
    last_sms_at: (lastSmsRes.data as { created_at: string } | null)?.created_at ?? null,
  });
}
