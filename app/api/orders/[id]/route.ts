import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { enrichActivityLog } from "@/lib/activity";
import { logActivity } from "@/lib/automation";
import { ACTIVITY_LOG_LIMIT, ORDER_QTY_FIELD_NAME } from "@/lib/constants";
import { linkCustomerFromOrderFields } from "@/lib/customers";
import { normalizeSkus, prepareSkusForSave, validateSkus } from "@/lib/skus";
import { validateDueDate, validateOrderQtyFromPayload } from "@/lib/order-form";
import { pruneOrphanedSkuAssets } from "@/lib/sku-assets";
import type { ActivityLog, Order } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: order } = await supabase
    .from("orders")
    .select("*, customer:customers(*)")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [{ data: assets }, { data: values }, { data: activity }, { data: approvals }, { data: missingInfoRows }, { data: approvalRows }] =
    await Promise.all([
      supabase
        .from("assets")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("custom_field_values").select("*").eq("order_id", id),
      supabase
        .from("activity_log")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LOG_LIMIT),
      supabase
        .from("approvals")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("job_notifications")
        .select("*")
        .eq("order_id", id)
        .eq("type", "missing_info")
        .order("created_at", { ascending: false }),
      supabase
        .from("job_notifications")
        .select("*")
        .eq("order_id", id)
        .eq("type", "customer_approval")
        .order("created_at", { ascending: false }),
    ]);

  const missingInfoList = missingInfoRows ?? [];
  const approvalList = approvalRows ?? [];
  const creatorIds = [
    ...new Set(
      [...missingInfoList, ...approvalList]
        .map((n) => n.created_by as string | null)
        .filter(Boolean) as string[]
    ),
  ];
  const notificationIds = missingInfoList.map((n) => n.id as string);

  let creatorNameById = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    creatorNameById = new Map(
      ((profiles ?? []) as { id: string; full_name: string | null }[]).map(
        (p) => [p.id, p.full_name ?? "Staff member"]
      )
    );
  }

  let assetsByNotification = new Map<string, typeof assets>();
  if (notificationIds.length > 0) {
    const { data: responseAssets } = await supabase
      .from("assets")
      .select("*")
      .in("notification_id", notificationIds);
    for (const asset of responseAssets ?? []) {
      const nid = asset.notification_id as string;
      const list = assetsByNotification.get(nid) ?? [];
      list.push(asset);
      assetsByNotification.set(nid, list);
    }
  }

  const missingInfo = missingInfoList.map((n) => ({
    ...n,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by as string) ?? null)
      : null,
    response_assets: assetsByNotification.get(n.id as string) ?? [],
  }));

  const approvalNotes = approvalList.map((n) => ({
    ...n,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by as string) ?? null)
      : null,
  }));

  const enrichedActivity = await enrichActivityLog(
    supabase,
    (activity ?? []) as ActivityLog[],
    order as Order
  );

  return NextResponse.json({
    order,
    assets: assets ?? [],
    values: values ?? [],
    activity: enrichedActivity,
    approvals: approvals ?? [],
    missingInfo,
    approvalNotes,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    description?: string | null;
    priority?: string;
    dueDate?: string | null;
    specs?: Record<string, unknown>;
    customFieldValues?: { customFieldId: string; value: unknown }[];
  };

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, tenant_id, due_date, specs, customer_id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingOrder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (body.dueDate !== undefined) {
    const dueDateError = validateDueDate(
      body.dueDate,
      (existingOrder as { due_date?: string | null }).due_date
    );
    if (dueDateError) {
      return NextResponse.json({ error: dueDateError }, { status: 400 });
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.dueDate !== undefined) updates.due_date = body.dueDate || null;
  if (body.specs !== undefined) {
    const rawSkus = body.specs.skus;
    if (rawSkus !== undefined) {
      const normalizedSkus = normalizeSkus(rawSkus);
      const skuError = validateSkus(normalizedSkus);
      if (skuError) {
        return NextResponse.json({ error: skuError }, { status: 400 });
      }
      updates.specs = {
        ...body.specs,
        skus: prepareSkusForSave(normalizedSkus),
      };
    } else {
      updates.specs = body.specs;
    }
  }

  if (body.customFieldValues) {
    const { data: orderQtyField } = await supabase
      .from("custom_fields")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", ORDER_QTY_FIELD_NAME)
      .maybeSingle();
    const skusForQty =
      body.specs?.skus !== undefined
        ? normalizeSkus(body.specs.skus)
        : normalizeSkus(
            (existingOrder as { specs?: { skus?: unknown } }).specs?.skus
          );
    const orderQtyError = validateOrderQtyFromPayload(
      (orderQtyField as { id: string } | null)?.id,
      body.customFieldValues,
      skusForQty
    );
    if (orderQtyError) {
      return NextResponse.json({ error: orderQtyError }, { status: 400 });
    }
  }

  if (body.customFieldValues && body.customFieldValues.length > 0) {
    try {
      const customerId = await linkCustomerFromOrderFields(
        supabase,
        ctx.tenant.id,
        body.customFieldValues,
        (existingOrder as { customer_id?: string | null }).customer_id ?? null,
        id
      );
      if (customerId) updates.customer_id = customerId;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save customer";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (updates.specs && Array.isArray((updates.specs as { skus?: unknown }).skus)) {
    await pruneOrphanedSkuAssets(
      supabase,
      id,
      (updates.specs as { skus: ReturnType<typeof prepareSkusForSave> }).skus
    );
  }

  if (body.customFieldValues && body.customFieldValues.length > 0) {
    const rows = body.customFieldValues.map((v) => ({
      order_id: id,
      custom_field_id: v.customFieldId,
      value: v.value,
    }));
    const { error } = await supabase
      .from("custom_field_values")
      .upsert(rows, { onConflict: "order_id,custom_field_id" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    actor: ctx.userId,
    action: "updated",
    metadata: { fields: Object.keys(updates) },
  });

  const { data: order } = await supabase
    .from("orders")
    .select("*, customer:customers(*)")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return NextResponse.json({ order });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingOrder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
