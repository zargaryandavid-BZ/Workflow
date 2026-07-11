import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/auth";
import { isAccountManagerOwner } from "@/lib/order-owners";
import { linkCustomerFromOrderFields } from "@/lib/customers";
import {
  logActivity,
  resolveColumnForNewJobByProduct,
} from "@/lib/automation";
import { ORDER_QTY_FIELD_NAME } from "@/lib/constants";
import { validateDueDate, validateOrderQtyFromPayload } from "@/lib/order-form";
import { normalizeSkus, prepareSkusForSave, validateSkus } from "@/lib/skus";

export type CreateOrderInput = {
  title?: string;
  description?: string;
  internalNote?: string | null;
  columnId?: string | null;
  ownerId?: string | null;
  priority?: string;
  dueDate?: string | null;
  specs?: Record<string, unknown>;
  customFieldValues?: { customFieldId: string; value: unknown }[];
};

export type CreateOrderResult =
  | { order: Record<string, unknown> }
  | { error: string; status: number };

function productFromCustomFieldValues(
  productFieldId: string | undefined,
  values: { customFieldId: string; value: unknown }[] | undefined
): string | null {
  if (!productFieldId || !values?.length) return null;
  const row = values.find((v) => v.customFieldId === productFieldId);
  if (!row) return null;
  if (typeof row.value === "string") return row.value.trim() || null;
  if (row.value == null) return null;
  return String(row.value).trim() || null;
}

export async function createOrder(
  supabase: SupabaseClient,
  ctx: TenantContext,
  body: CreateOrderInput
): Promise<CreateOrderResult> {
  if (!body.title?.trim()) {
    return { error: "Title is required", status: 400 };
  }

  const dueDateError = validateDueDate(body.dueDate);
  if (dueDateError) {
    return { error: dueDateError, status: 400 };
  }

  const normalizedSkus = normalizeSkus(body.specs?.skus);
  const skuError = validateSkus(normalizedSkus);
  if (skuError) {
    return { error: skuError, status: 400 };
  }

  const tenantId = ctx.tenant.id;

  const [{ data: orderQtyField }, { data: productField }] = await Promise.all([
    supabase
      .from("custom_fields")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", ORDER_QTY_FIELD_NAME)
      .maybeSingle(),
    supabase
      .from("custom_fields")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", "product")
      .maybeSingle(),
  ]);
  const orderQtyError = validateOrderQtyFromPayload(
    (orderQtyField as { id: string } | null)?.id,
    body.customFieldValues,
    normalizedSkus
  );
  if (orderQtyError) {
    return { error: orderQtyError, status: 400 };
  }

  let columnId = body.columnId ?? undefined;
  if (!columnId) {
    const { data: firstCol } = await supabase
      .from("board_columns")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    columnId = (firstCol as { id: string } | null)?.id;
  } else {
    const { data: column } = await supabase
      .from("board_columns")
      .select("id")
      .eq("id", columnId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!column) {
      return { error: "Invalid column", status: 400 };
    }
  }
  if (!columnId) {
    return { error: "No columns found", status: 400 };
  }

  const product = productFromCustomFieldValues(
    (productField as { id: string } | null)?.id,
    body.customFieldValues
  );
  const routed = await resolveColumnForNewJobByProduct(
    supabase,
    tenantId,
    product
  );
  if (routed) {
    columnId = routed.columnId;
  }

  if (body.ownerId) {
    const valid = await isAccountManagerOwner(
      supabase,
      tenantId,
      body.ownerId
    );
    if (!valid) {
      return { error: "Owner must be an account manager", status: 400 };
    }
  }

  let createdBy: string | null = null;
  if (body.ownerId) {
    createdBy = body.ownerId;
  } else if (await isAccountManagerOwner(supabase, tenantId, ctx.userId)) {
    createdBy = ctx.userId;
  }

  const { data: last } = await supabase
    .from("orders")
    .select("position")
    .eq("column_id", columnId)
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position: number } | null)?.position ?? 0) + 1000;

  const fieldValues = (body.customFieldValues ?? []).filter(
    (v) => v.value !== null && v.value !== undefined && v.value !== ""
  );

  let customerId: string | null = null;
  if (fieldValues.length > 0) {
    try {
      customerId = await linkCustomerFromOrderFields(
        supabase,
        ctx.tenant.id,
        fieldValues
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save customer";
      return { error: message, status: 400 };
    }
  }

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      tenant_id: tenantId,
      column_id: columnId,
      title: body.title.trim(),
      description: body.description ?? null,
      internal_note: body.internalNote
        ? JSON.stringify([
            {
              author: ctx.fullName ?? ctx.email ?? "Unknown",
              date: new Date().toISOString(),
              text: body.internalNote,
            },
          ])
        : null,
      customer_id: customerId,
      priority: body.priority ?? "normal",
      due_date: body.dueDate || null,
      specs: {
        ...(body.specs ?? {}),
        skus: prepareSkusForSave(normalizedSkus),
      },
      position,
      created_by: createdBy,
      last_moved_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return { error: error.message, status: 400 };
  }

  if (fieldValues.length > 0) {
    await supabase.from("custom_field_values").insert(
      fieldValues.map((v) => ({
        order_id: order.id,
        custom_field_id: v.customFieldId,
        value: v.value,
      }))
    );
  }

  const { data: column } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", columnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  await logActivity(supabase, {
    tenantId,
    orderId: order.id,
    actor: ctx.userId,
    action: "created",
    metadata: {
      title: order.title,
      column: (column as { name: string } | null)?.name ?? null,
      ...(routed
        ? {
            product_route: routed.product,
            product_route_column: routed.columnName,
          }
        : {}),
    },
  });

  return { order };
}
