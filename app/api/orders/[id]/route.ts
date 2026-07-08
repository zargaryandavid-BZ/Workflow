import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { enrichActivityLog } from "@/lib/activity";
import { logActivity } from "@/lib/automation";
import { ACTIVITY_LOG_LIMIT, ORDER_QTY_FIELD_NAME } from "@/lib/constants";
import { isAccountManagerOwner } from "@/lib/order-owners";
import { linkCustomerFromOrderFields } from "@/lib/customers";
import { normalizeSkus, prepareSkusForSave, validateSkus } from "@/lib/skus";
import { validateDueDate, validateOrderQtyFromPayload } from "@/lib/order-form";
import { pruneOrphanedSkuAssets } from "@/lib/sku-assets";
import {
  attachSignedUrlsToSkuImages,
  listSkuImagesForOrder,
  pruneOrphanedSkuImages,
} from "@/lib/sku-images";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import {
  filterValidCustomFieldValues,
  staleCustomFieldsMessage,
} from "@/lib/custom-field-values.server";
import type { ActivityLog, CustomField, Order, OrderNote } from "@/lib/types";

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

  const order = await loadOrderWithRelations(supabase, id, tenantId);
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [{ data: assets }, { data: values }, { data: activity }, { data: approvals }, { data: missingInfoRows }, { data: approvalRows }, { data: notesRows }] =
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
      supabase
        .from("order_notes")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const missingInfoList = missingInfoRows ?? [];
  const approvalList = approvalRows ?? [];
  const notesList = (notesRows ?? []) as { id: string; tenant_id: string; order_id: string; created_by: string | null; text: string; created_at: string }[];
  const creatorIds = [
    ...new Set(
      [...missingInfoList, ...approvalList, ...notesList]
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

  let skuImages: Awaited<ReturnType<typeof attachSignedUrlsToSkuImages>> = [];
  try {
    const raw = await listSkuImagesForOrder(supabase, id);
    skuImages = await attachSignedUrlsToSkuImages(supabase, raw);
  } catch {
    skuImages = [];
  }

  const { data: customFields } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  const notes: OrderNote[] = notesList.map((n) => ({
    id: n.id,
    tenant_id: n.tenant_id,
    order_id: n.order_id,
    created_by: n.created_by,
    creator_name: n.created_by
      ? (creatorNameById.get(n.created_by) ?? "Staff member")
      : null,
    text: n.text,
    created_at: n.created_at,
  }));

  return NextResponse.json({
    order,
    assets: assets ?? [],
    skuImages,
    values: values ?? [],
    customFields: (customFields ?? []) as CustomField[],
    activity: enrichedActivity,
    approvals: approvals ?? [],
    missingInfo,
    approvalNotes,
    notes,
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
    internal_note?: string | null;
    priority?: string;
    ownerId?: string | null;
    dueDate?: string | null;
    tagId?: string | null;
    specs?: Record<string, unknown>;
    customFieldValues?: { customFieldId: string; value: unknown }[];
  };

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, tenant_id, title, description, priority, due_date, specs, customer_id, created_by, tag_id")
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
  if (body.internal_note !== undefined) updates.internal_note = body.internal_note;
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.tagId !== undefined) updates.tag_id = body.tagId ?? null;
  if (body.ownerId !== undefined) {
    if (body.ownerId) {
      const valid = await isAccountManagerOwner(
        supabase,
        tenantId,
        body.ownerId
      );
      if (!valid) {
        return NextResponse.json(
          { error: "Owner must be an account manager" },
          { status: 400 }
        );
      }
      updates.created_by = body.ownerId;
    } else {
      updates.created_by = null;
    }
  }
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
    const { valid, invalidIds } = await filterValidCustomFieldValues(
      supabase,
      tenantId,
      body.customFieldValues
    );
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: staleCustomFieldsMessage(invalidIds) },
        { status: 400 }
      );
    }

    try {
      const customerId = await linkCustomerFromOrderFields(
        supabase,
        ctx.tenant.id,
        valid,
        (existingOrder as { customer_id?: string | null }).customer_id ?? null,
        id
      );
      if (customerId) updates.customer_id = customerId;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save customer";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const rows = valid.map((v) => ({
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
    const savedSkus = (updates.specs as { skus: ReturnType<typeof prepareSkusForSave> })
      .skus;
    await pruneOrphanedSkuAssets(supabase, id, savedSkus);
    try {
      await pruneOrphanedSkuImages(supabase, id, savedSkus);
    } catch {
      // order_sku_images table may not exist yet
    }
  }

  // Look up tag names when the tag is being changed so activity shows e.g. "Tag: Waiting → Approved".
  let oldTagName: string | null = null;
  let newTagName: string | null = null;
  if (updates.tag_id !== undefined && updates.tag_id !== (existingOrder as Record<string, unknown>).tag_id) {
    const tagIdsToFetch = [
      (existingOrder as Record<string, unknown>).tag_id as string | null,
      updates.tag_id as string | null,
    ].filter((tid): tid is string => !!tid);
    if (tagIdsToFetch.length > 0) {
      const { data: tagRows } = await supabase
        .from("tags")
        .select("id, name")
        .in("id", tagIdsToFetch);
      const tagMap = new Map(
        ((tagRows ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name])
      );
      oldTagName = ((existingOrder as Record<string, unknown>).tag_id as string | null)
        ? (tagMap.get((existingOrder as Record<string, unknown>).tag_id as string) ?? null)
        : null;
      newTagName = updates.tag_id
        ? (tagMap.get(updates.tag_id as string) ?? null)
        : null;
    }
  }

  // Build a human-readable change list for the activity log.
  type ChangeEntry = { field: string; from?: unknown; to?: unknown };
  const changes: ChangeEntry[] = [];
  const existing = existingOrder as Record<string, unknown> & {
    specs?: Record<string, unknown>;
  };

  if (updates.title !== undefined && updates.title !== existing.title)
    changes.push({ field: "Order number", from: existing.title, to: updates.title });
  if (updates.priority !== undefined && updates.priority !== existing.priority)
    changes.push({ field: "Priority", from: existing.priority, to: updates.priority });
  if (updates.due_date !== undefined && (updates.due_date ?? null) !== (existing.due_date ?? null))
    changes.push({ field: "Due date", from: existing.due_date ?? null, to: updates.due_date ?? null });
  if (updates.description !== undefined && (updates.description ?? "") !== (existing.description ?? ""))
    changes.push({
      field: "Description updated",
      from: existing.description ?? "",
      to: updates.description ?? "",
    });
  if (updates.created_by !== undefined && updates.created_by !== existing.created_by)
    changes.push({ field: "Owner changed" });
  if (updates.tag_id !== undefined && updates.tag_id !== existing.tag_id)
    changes.push({ field: "Tag", from: oldTagName, to: newTagName });

  if (updates.specs !== undefined) {
    const oldSpecs = (existing.specs ?? {}) as Record<string, unknown>;
    const newSpecs = (updates.specs ?? {}) as Record<string, unknown>;
    const oldDesigner = (oldSpecs.designer_name as string | undefined) ?? null;
    const newDesigner = (newSpecs.designer_name as string | undefined) ?? null;
    if ((newSpecs.designer_id ?? null) !== (oldSpecs.designer_id ?? null))
      changes.push({ field: "Designer", from: oldDesigner, to: newDesigner });

    const oldDesignTask = (oldSpecs.design_task as string | undefined) ?? "";
    const newDesignTask = (newSpecs.design_task as string | undefined) ?? "";
    if (newDesignTask !== oldDesignTask)
      changes.push({ field: "Design task updated" });

    const oldSkus = Array.isArray(oldSpecs.skus) ? oldSpecs.skus : [];
    const newSkus = Array.isArray(newSpecs.skus) ? newSpecs.skus : [];
    if (newSkus.length !== oldSkus.length)
      changes.push({ field: "SKUs", from: oldSkus.length, to: newSkus.length });
    else if (JSON.stringify(oldSkus) !== JSON.stringify(newSkus))
      changes.push({ field: "SKUs updated" });
  }

  if (body.customFieldValues && body.customFieldValues.length > 0) {
    const cfIds = body.customFieldValues.map((v) => v.customFieldId);
    const [{ data: cfDefs }, { data: oldCfv }] = await Promise.all([
      supabase.from("custom_fields").select("id, name").in("id", cfIds),
      supabase.from("custom_field_values").select("custom_field_id, value").eq("order_id", id).in("custom_field_id", cfIds),
    ]);
    const nameById = new Map(
      ((cfDefs ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name])
    );
    const oldValById = new Map(
      ((oldCfv ?? []) as { custom_field_id: string; value: unknown }[]).map((v) => [v.custom_field_id, v.value])
    );
    const SKIP_CF = new Set(["customer name", "customer contact", "order qty"]);
    for (const cfv of body.customFieldValues) {
      const name = nameById.get(cfv.customFieldId) ?? "";
      if (!name || SKIP_CF.has(name.toLowerCase())) continue;
      const oldVal = oldValById.get(cfv.customFieldId) ?? null;
      const newVal = cfv.value ?? null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        if (typeof newVal === "boolean")
          changes.push({ field: name, to: newVal ? "Yes" : "No" });
        else if (oldVal !== null && oldVal !== "")
          changes.push({ field: name, from: oldVal, to: newVal });
        else
          changes.push({ field: name, to: newVal });
      }
    }
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    actor: ctx.userId,
    action: "updated",
    metadata: { changes },
  });

  const order = await loadOrderWithRelations(supabase, id, tenantId);

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
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, removed_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingOrder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existingOrder.removed_at) {
    return NextResponse.json({ error: "Order is already removed" }, { status: 400 });
  }

  const removedAt = new Date().toISOString();
  const { error } = await supabase
    .from("orders")
    .update({
      removed_at: removedAt,
      removed_by: ctx.userId,
    })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logActivity(supabase, {
    tenantId: ctx.tenant.id,
    orderId: id,
    actor: ctx.userId,
    action: "removed",
  });

  return NextResponse.json({ ok: true, removedAt });
}
