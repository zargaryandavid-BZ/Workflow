import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { logActivity } from "@/lib/automation";
import { ORDER_QTY_FIELD_ALIASES } from "@/lib/constants";
import { isAccountManagerOwner } from "@/lib/order-owners";
import { linkCustomerFromOrderFields } from "@/lib/customers";
import { normalizeSkus, prepareSkusForSave, validateSkus, describeSkuActivityChanges } from "@/lib/skus";
import {
  buildStaffDueSpecs,
  mergeDueSpecsIntoOrderSpecs,
  readOrderDueSpecs,
  type DueDateMode,
} from "@/lib/due-date";
import { validateDueDate, validateOrderQtyFromPayload } from "@/lib/order-form";
import { pruneOrphanedSkuAssets } from "@/lib/sku-assets";
import {
  attachSignedUrlsToSkuImages,
  listSkuImagesForOrder,
  mergeSkuImagesWithAssets,
  pruneOrphanedSkuImages,
} from "@/lib/sku-images";
import { withCanonicalDesignerName } from "@/lib/order-designer";
import { preserveDesignTaskUrl } from "@/lib/design-task";
import { preserveCardImage } from "@/lib/card-image";
import { preserveFinishedCustomerSms } from "@/lib/finished-order-sms";
import { loadOrderWithRelations } from "@/lib/orders/load-with-relations";
import {
  canEditOrderDetails,
  canEditOrderTitle,
  isManualCreatedOrder,
  orderPatchRequiresFormEdit,
} from "@/lib/permissions";
import {
  filterValidCustomFieldValues,
  staleCustomFieldsMessage,
} from "@/lib/custom-field-values.server";
import {
  loadOrderFieldValueMap,
  sendTagNotifications,
} from "@/lib/tag-notifications";
import type {
  Asset,
  CustomField,
  OrderWithRelations,
  ShippingRequest,
  Tag,
} from "@/lib/types";
import { notifyDesignerOfSalesNote, notifyMentionedInNotes } from "@/lib/user-notifications";

const ORDER_QTY_NAME_SET = new Set(
  ORDER_QTY_FIELD_ALIASES.map((n) => n.toLowerCase())
);

type AppSupabase = Awaited<ReturnType<typeof createClient>>;

async function recordSaveActivity(
  supabase: AppSupabase,
  params: {
    tenantId: string;
    userId: string;
    orderId: string;
    updates: Record<string, unknown>;
    existingOrder: Record<string, unknown>;
    customFieldValues?: Array<{ customFieldId: string; value: unknown }>;
    /** Snapshot taken before upsert — required so diffs see prior values. */
    previousCustomFieldValues?: Array<{
      custom_field_id: string;
      value: unknown;
    }>;
  }
): Promise<void> {
  const {
    tenantId,
    userId,
    orderId,
    updates,
    existingOrder,
    customFieldValues,
    previousCustomFieldValues,
  } = params;

  // Tag name lookup (only when tag changed)
  let oldTagName: string | null = null;
  let newTagName: string | null = null;
  if (
    updates.tag_id !== undefined &&
    updates.tag_id !== existingOrder.tag_id
  ) {
    const tagIdsToFetch = [
      existingOrder.tag_id as string | null,
      updates.tag_id as string | null,
    ].filter((tid): tid is string => !!tid);
    if (tagIdsToFetch.length > 0) {
      const { data: tagRows } = await supabase
        .from("tags")
        .select("id, name")
        .in("id", tagIdsToFetch);
      const tagMap = new Map(
        ((tagRows ?? []) as { id: string; name: string }[]).map((t) => [
          t.id,
          t.name,
        ])
      );
      oldTagName = existingOrder.tag_id
        ? (tagMap.get(existingOrder.tag_id as string) ?? null)
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
    changes.push({
      field: "Order number",
      from: existing.title,
      to: updates.title,
    });
  if (updates.priority !== undefined && updates.priority !== existing.priority)
    changes.push({
      field: "Priority",
      from: existing.priority,
      to: updates.priority,
    });
  if (
    updates.due_date !== undefined &&
    (updates.due_date ?? null) !== (existing.due_date ?? null)
  )
    changes.push({
      field: "Due date",
      from: existing.due_date ?? null,
      to: updates.due_date ?? null,
    });
  if (
    updates.description !== undefined &&
    (updates.description ?? "") !== (existing.description ?? "")
  )
    changes.push({
      field: "Description updated",
      from: existing.description ?? "",
      to: updates.description ?? "",
    });
  if (
    updates.created_by !== undefined &&
    updates.created_by !== existing.created_by
  )
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
    const skuChanges = describeSkuActivityChanges(oldSkus, newSkus);
    if (skuChanges.length > 0) {
      changes.push(...skuChanges);
    }
  }

  if (customFieldValues && customFieldValues.length > 0) {
    const cfIds = customFieldValues.map((v) => v.customFieldId);
    const { data: cfDefs } = await supabase
      .from("custom_fields")
      .select("id, name")
      .in("id", cfIds);
    const nameById = new Map(
      ((cfDefs ?? []) as { id: string; name: string }[]).map((f) => [
        f.id,
        f.name,
      ])
    );
    const oldValById = new Map(
      (previousCustomFieldValues ?? []).map((v) => [
        v.custom_field_id,
        v.value,
      ])
    );
    const SKIP_CF = new Set(["customer name", "customer contact"]);
    const qtyAlreadyLogged = changes.some((c) => c.field === "Qty");
    for (const cfv of customFieldValues) {
      const name = nameById.get(cfv.customFieldId) ?? "";
      if (!name || SKIP_CF.has(name.toLowerCase())) continue;
      const isQtyField = ORDER_QTY_NAME_SET.has(name.toLowerCase());
      if (isQtyField && qtyAlreadyLogged) continue;
      const oldVal = oldValById.get(cfv.customFieldId) ?? null;
      const newVal = cfv.value ?? null;
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        const fieldLabel = isQtyField ? "Qty" : name;
        if (typeof newVal === "boolean")
          changes.push({ field: fieldLabel, to: newVal ? "Yes" : "No" });
        else if (oldVal !== null && oldVal !== "")
          changes.push({ field: fieldLabel, from: oldVal, to: newVal });
        else changes.push({ field: fieldLabel, to: newVal });
      }
    }
  }

  if (changes.length === 0) return;

  await logActivity(supabase, {
    tenantId,
    orderId,
    actor: userId,
    action: "updated",
    metadata: { changes },
  });
}

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

  // Core detail only — activity / notifications / approvals load via /timeline.
  // Order + related rows run in parallel (id/tenant known from params/context).
  const [
    order,
    assetsResult,
    valuesResult,
    shippingResult,
    skuImagesRaw,
    notificationTypesResult,
  ] = await Promise.all([
    loadOrderWithRelations(supabase, id, tenantId),
    supabase
      .from("assets")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("custom_field_values").select("*").eq("order_id", id),
    supabase
      .from("shipping_requests")
      .select("*")
      .eq("order_id", id)
      .order("created_at", { ascending: false })
      .limit(1),
    listSkuImagesForOrder(supabase, id).catch(() => []),
    supabase.from("job_notifications").select("type").eq("order_id", id),
  ]);

  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const shippingRequest =
    shippingResult.error || !shippingResult.data?.[0]
      ? null
      : (shippingResult.data[0] as ShippingRequest);

  const assets = (assetsResult.data ?? []) as Asset[];
  const skuImagesSigned = await attachSignedUrlsToSkuImages(
    supabase,
    skuImagesRaw
  ).catch(() => []);

  const orderSkus = normalizeSkus(
    (order.specs as { skus?: unknown } | null)?.skus
  );
  const skuImages = mergeSkuImagesWithAssets(skuImagesSigned, assets, {
    soleSkuId: orderSkus.length === 1 ? orderSkus[0].id : null,
  });

  const notificationTypes = (notificationTypesResult.data ?? []) as {
    type: string;
  }[];
  const hasMissingInfo = notificationTypes.some((n) => n.type === "missing_info");
  const hasApproval = notificationTypes.some(
    (n) => n.type === "customer_approval"
  );

  return NextResponse.json({
    order,
    assets,
    skuImages,
    values: valuesResult.data ?? [],
    // Board already has field defs — avoid a redundant tenant-wide query.
    activity: [],
    approvals: [],
    missingInfo: [],
    approvalNotes: [],
    notifications: [],
    notes: [],
    shippingRequest,
    timelinePending: true,
    tabHints: { hasMissingInfo, hasApproval },
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
    dueDateMode?: DueDateMode | null;
    dueProcessingDays?: number | null;
    tagId?: string | null;
    specs?: Record<string, unknown>;
    customFieldValues?: { customFieldId: string; value: unknown }[];
  };

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  const { data: existingOrder } = await supabase
    .from("orders")
    .select(
      "id, tenant_id, title, description, priority, due_date, specs, customer_id, created_by, tag_id, webhook_source, internal_note"
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existingOrder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const existingSpecs =
    ((existingOrder as { specs?: Record<string, unknown> }).specs ??
      {}) as Record<string, unknown>;

  if (
    orderPatchRequiresFormEdit(body, existingSpecs) &&
    !canEditOrderDetails(ctx.role, existingOrder)
  ) {
    return NextResponse.json(
      {
        error:
          "Only Admin, Sales (Account Manager), Pre-prod, and Designer can edit order details.",
      },
      { status: 403 }
    );
  }

  // CRM / webhook order numbers are immutable.
  if (
    body.title !== undefined &&
    String(body.title).trim() !== String(existingOrder.title ?? "").trim() &&
    !canEditOrderTitle(ctx.role, existingOrder)
  ) {
    return NextResponse.json(
      {
        error: isManualCreatedOrder(existingOrder)
          ? "You don’t have permission to change the order number."
          : "CRM / webhook order numbers can’t be changed.",
      },
      { status: 403 }
    );
  }

  const existingDue = readOrderDueSpecs(existingSpecs);
  const dueFieldsTouched =
    body.dueDate !== undefined ||
    body.dueDateMode !== undefined ||
    body.dueProcessingDays !== undefined;

  let staffDue: ReturnType<typeof buildStaffDueSpecs> | null = null;
  if (dueFieldsTouched) {
    const mode: DueDateMode =
      body.dueDateMode === "after_approval" ||
      body.dueDateMode === "fixed"
        ? body.dueDateMode
        : existingDue.due_date_mode === "after_approval"
          ? "after_approval"
          : "fixed";
    staffDue = buildStaffDueSpecs({
      mode,
      dueDate:
        body.dueDate !== undefined
          ? body.dueDate
          : (existingOrder as { due_date?: string | null }).due_date,
      processingDays:
        body.dueProcessingDays !== undefined
          ? body.dueProcessingDays
          : existingDue.due_processing_days,
      previousSpecs: existingSpecs,
    });
    if (mode === "fixed") {
      const dueDateError = validateDueDate(
        staffDue.dueDate,
        (existingOrder as { due_date?: string | null }).due_date
      );
      if (dueDateError) {
        return NextResponse.json({ error: dueDateError }, { status: 400 });
      }
    } else if (
      staffDue.specs.due_processing_days == null ||
      staffDue.specs.due_processing_days < 1
    ) {
      return NextResponse.json(
        { error: "Working days after approval must be at least 1." },
        { status: 400 }
      );
    }
  } else if (body.dueDate !== undefined) {
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
          { error: "Owner must be an account manager or admin" },
          { status: 400 }
        );
      }
      updates.created_by = body.ownerId;
    } else {
      updates.created_by = null;
    }
  }
  if (staffDue) {
    updates.due_date = staffDue.dueDate;
  } else if (body.dueDate !== undefined) {
    updates.due_date = body.dueDate || null;
  }
  if (body.specs !== undefined) {
    const rawSkus = body.specs.skus;
    let nextSpecs: Record<string, unknown>;
    if (rawSkus !== undefined) {
      const normalizedSkus = normalizeSkus(rawSkus);
      const skuError = validateSkus(normalizedSkus);
      if (skuError) {
        return NextResponse.json({ error: skuError }, { status: 400 });
      }
      nextSpecs = {
        ...body.specs,
        skus: prepareSkusForSave(normalizedSkus),
      };
    } else {
      nextSpecs = body.specs;
    }
    updates.specs = staffDue
      ? mergeDueSpecsIntoOrderSpecs(nextSpecs, staffDue.specs)
      : nextSpecs;
    updates.specs = preserveFinishedCustomerSms(
      existingSpecs,
      preserveCardImage(
        existingSpecs,
        preserveDesignTaskUrl(
          existingSpecs,
          updates.specs as Record<string, unknown>
        )
      )
    );
  } else if (staffDue) {
    updates.specs = mergeDueSpecsIntoOrderSpecs(existingSpecs, staffDue.specs);
  }

  if (updates.specs && typeof updates.specs === "object") {
    updates.specs = await withCanonicalDesignerName(
      supabase,
      updates.specs as Record<string, unknown>
    );
  }

  if (body.customFieldValues) {
    let orderQtyFieldId: string | undefined;
    {
      const aliases = ORDER_QTY_FIELD_ALIASES;
      // Single query instead of N sequential queries — OR across all aliases.
      // Quote values so names with spaces (e.g. "Order QTY") parse correctly.
      const orFilter = aliases.map((n) => `name.ilike."${n}"`).join(",");
      const { data: orderQtyFields } = await supabase
        .from("custom_fields")
        .select("id")
        .eq("tenant_id", tenantId)
        .or(orFilter)
        .limit(1);
      const first = (orderQtyFields ?? [])[0] as { id?: string } | undefined;
      if (first && typeof first.id === "string") {
        orderQtyFieldId = first.id;
      }
    }
    const skusForQty =
      body.specs?.skus !== undefined
        ? normalizeSkus(body.specs.skus)
        : normalizeSkus(
            (existingOrder as { specs?: { skus?: unknown } }).specs?.skus
          );
    const orderQtyError = validateOrderQtyFromPayload(
      orderQtyFieldId,
      body.customFieldValues,
      skusForQty
    );
    if (orderQtyError) {
      return NextResponse.json({ error: orderQtyError }, { status: 400 });
    }
  }

  let previousCustomFieldValues:
    | Array<{ custom_field_id: string; value: unknown }>
    | undefined;

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

    // Snapshot before upsert so activity diffs compare against prior values.
    const cfIds = valid.map((v) => v.customFieldId);
    const { data: oldCfv } = await supabase
      .from("custom_field_values")
      .select("custom_field_id, value")
      .eq("order_id", id)
      .in("custom_field_id", cfIds);
    previousCustomFieldValues = (oldCfv ?? []) as Array<{
      custom_field_id: string;
      value: unknown;
    }>;

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

  if (updates.specs && typeof updates.specs === "object") {
    void notifyDesignerOfSalesNote({
      client: supabase,
      tenantId,
      orderId: id,
      orderTitle: String(
        (updates.title as string | undefined) ?? existingOrder.title ?? "order"
      ),
      actorId: ctx.userId,
      actorName: ctx.fullName?.trim() || ctx.email || "Sales",
      actorRole: ctx.role,
      previousSpecs: existingSpecs,
      nextSpecs: updates.specs as Record<string, unknown>,
    }).catch((err) => console.error("[user-notifications]", err));
  }

  const nextSpecsForMentions =
    updates.specs && typeof updates.specs === "object"
      ? (updates.specs as Record<string, unknown>)
      : existingSpecs;
  const nextInternalForMentions =
    updates.internal_note !== undefined
      ? (updates.internal_note as string | null)
      : ((existingOrder as { internal_note?: string | null }).internal_note ??
        null);
  void notifyMentionedInNotes({
    client: supabase,
    tenantId,
    orderId: id,
    orderTitle: String(
      (updates.title as string | undefined) ?? existingOrder.title ?? "order"
    ),
    actorId: ctx.userId,
    actorName: ctx.fullName?.trim() || ctx.email || "Someone",
    previousInternalNote:
      (existingOrder as { internal_note?: string | null }).internal_note ?? null,
    nextInternalNote: nextInternalForMentions,
    previousSpecs: existingSpecs,
    nextSpecs: nextSpecsForMentions,
  }).catch((err) => console.error("[user-notifications]", err));

  // Fire-and-forget — do not await; client doesn't need activity log data
  void recordSaveActivity(supabase, {
    tenantId,
    userId: ctx.userId,
    orderId: id,
    updates: updates as Record<string, unknown>,
    existingOrder: existingOrder as Record<string, unknown>,
    customFieldValues: body.customFieldValues,
    previousCustomFieldValues,
  }).catch((err) => console.error("[activity-log]", err));

  // Build a minimal order object from what we already have in memory.
  // The client only reads `error` and `tagNotifyWarning` — it does NOT
  // use the returned `order` in the normal save path (see card-detail-modal.tsx).
  // Optional `?reload=true` keeps a fully-joined order for rare callers.
  const url = new URL(request.url);
  const forceReload = url.searchParams.get("reload") === "true";
  const order = forceReload
    ? await loadOrderWithRelations(supabase, id, tenantId)
    : ({
        ...(existingOrder as Record<string, unknown>),
        ...updates,
        id,
      } as OrderWithRelations);

  let tagNotifyWarning: string | null = null;
  // Fire when the order's tag is newly set or changed to a different tag.
  const previousTagId =
    (existingOrder as { tag_id?: string | null }).tag_id ?? null;
  const nextTagId =
    body.tagId !== undefined ? body.tagId || null : previousTagId;
  if (nextTagId && nextTagId !== previousTagId) {
    try {
      const { data: tagRow } = await supabase
        .from("tags")
        .select("*")
        .eq("id", nextTagId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (tagRow && (tagRow as Tag).notify_enabled && order) {
        const { data: customFields } = await supabase
          .from("custom_fields")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("position", { ascending: true });

        const fieldValues = await loadOrderFieldValueMap(supabase, id);
        const result = await sendTagNotifications({
          client: supabase,
          tenantId,
          orderId: id,
          tag: tagRow as Tag,
          order: order as OrderWithRelations,
          customFields: (customFields ?? []) as CustomField[],
          fieldValues,
        });

        if (result.warnings.length > 0) {
          tagNotifyWarning = result.warnings.join(" ");
        }
      }
    } catch (err) {
      console.error("[tag-notify]", err);
      tagNotifyWarning =
        err instanceof Error
          ? err.message
          : "Tag notification failed.";
    }
  }

  return NextResponse.json({
    order,
    ...(tagNotifyWarning ? { tagNotifyWarning } : {}),
  });
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
