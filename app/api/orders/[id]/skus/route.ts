import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { canEditOrderDetails } from "@/lib/permissions";
import { normalizeSkus, prepareSkusForSave, type SkuItem } from "@/lib/skus";

/**
 * Upsert a single SKU into orders.specs.skus so gallery uploads can attach.
 * Does not validate or rewrite unrelated SKU rows (avoids blocking on CRM
 * rows that have a name but no quantity yet).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    qty?: number | null;
  };

  const skuId = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const qty =
    typeof body.qty === "number" && !Number.isNaN(body.qty) ? body.qty : null;

  if (!skuId) {
    return NextResponse.json({ error: "SKU id is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json(
      { error: "Enter SKU name before uploading images." },
      { status: 400 }
    );
  }
  if (qty == null || qty < 1) {
    return NextResponse.json(
      { error: "Enter SKU quantity (at least 1) before uploading images." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: order } = await supabase
    .from("orders")
    .select("id, tenant_id, webhook_source, specs")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canEditOrderDetails(ctx.role, order)) {
    return NextResponse.json(
      {
        error:
          "Only Admin, Sales (Account Manager), Pre-prod, and Designer can edit order details.",
      },
      { status: 403 }
    );
  }

  const existingSpecs =
    ((order as { specs?: Record<string, unknown> }).specs ??
      {}) as Record<string, unknown>;
  const existingSkus = normalizeSkus(existingSpecs.skus);
  const nextSku: SkuItem = {
    id: skuId,
    name,
    qty: Math.floor(qty),
  };
  const byId = new Map(existingSkus.map((s) => [s.id, s]));
  byId.set(skuId, nextSku);
  const nextSkus = prepareSkusForSave([...byId.values()]);

  const { error } = await supabase
    .from("orders")
    .update({
      specs: {
        ...existingSpecs,
        skus: nextSkus,
      },
    })
    .eq("id", orderId)
    .eq("tenant_id", tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, skus: nextSkus, sku: nextSku });
}
