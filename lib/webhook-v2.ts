import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertCustomer } from "@/lib/customers";
import {
  asTrimmedString,
  isRecord,
  isStaleCrmUpdate,
  overrideKeysOf,
  validateWebhookV2,
  type WebhookV2Payload,
} from "@/lib/webhook-v2-parse";
import {
  RUSH_ORDER_TAG_NAME,
  webhookRushFromPayload,
} from "@/lib/order-rush";

export {
  isCrmWebhookV2,
  isStaleCrmUpdate,
  overrideKeysOf,
  validateWebhookV2,
  type WebhookV2Payload,
} from "@/lib/webhook-v2-parse";

type Client = SupabaseClient;

export type WebhookV2HttpResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

async function resolveOwner(
  client: Client,
  tenantId: string,
  payload: WebhookV2Payload
) {
  const { resolveWebhookOwner } = await import("@/lib/webhook-order");
  return resolveWebhookOwner(client, tenantId, {
    owner_email: payload.request_owner?.email,
    owner_name: payload.request_owner?.name,
    owner: payload.request_owner?.email ?? payload.request_owner?.name,
    request_owner_email: payload.request_owner?.email,
    request_owner_name: payload.request_owner?.name,
    request_owner: payload.request_owner?.email ?? payload.request_owner?.name,
  });
}

async function writeActivity(
  client: Client,
  params: {
    tenantId: string;
    orderId: string | null;
    actor: string | null;
    action: string;
    metadata?: Record<string, unknown>;
  }
) {
  const { logActivity } = await import("@/lib/automation");
  await logActivity(client, params);
}

function customerFromPayload(payload: WebhookV2Payload): {
  name?: string;
  email?: string | null;
  phone?: string | null;
} {
  return {
    name: asTrimmedString(payload.customer?.name) ?? undefined,
    email: asTrimmedString(payload.customer?.email),
    phone: asTrimmedString(payload.customer?.phone),
  };
}

function firstProductName(payload: WebhookV2Payload): string | null {
  const first = payload.line_items[0];
  if (!isRecord(first)) return null;
  if (isRecord(first.product)) {
    return asTrimmedString(first.product.name);
  }
  return asTrimmedString(first.product_name) ?? asTrimmedString(first.name);
}

function skusFromLineItems(payload: WebhookV2Payload): Array<{
  id: string;
  name: string;
  qty: number;
}> {
  return payload.line_items.map((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const product = isRecord(item.product) ? item.product : null;
    const name =
      (product ? asTrimmedString(product.name) : null) ??
      asTrimmedString(item.product_name) ??
      asTrimmedString(item.name) ??
      `Item ${index + 1}`;
    const qtyRaw = item.quantity;
    const qty =
      typeof qtyRaw === "number" && Number.isFinite(qtyRaw) && qtyRaw >= 1
        ? Math.floor(qtyRaw)
        : 1;
    const id =
      asTrimmedString(item.line_item_id) ?? `li-${index + 1}`;
    return { id, name, qty };
  });
}

async function claimEventId(
  client: Client,
  eventId: string
): Promise<"claimed" | "duplicate"> {
  const { error } = await client
    .from("processed_webhook_events")
    .insert({ event_id: eventId });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  throw new Error(error.message);
}

async function pruneOldWebhookEvents(client: Client): Promise<void> {
  try {
    await client
      .from("processed_webhook_events")
      .delete()
      .lt(
        "processed_at",
        new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      );
  } catch (err) {
    console.error(
      "[webhook/v2] dedup prune failed:",
      err instanceof Error ? err.message : err
    );
  }
}

async function firstBoardColumn(
  client: Client,
  tenantId: string
): Promise<{ id: string; name: string | null } | null> {
  const { data } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return null;
  return { id: data.id as string, name: (data.name as string | null) ?? null };
}

async function nextPosition(
  client: Client,
  tenantId: string,
  columnId: string
): Promise<number> {
  const { data } = await client
    .from("orders")
    .select("position")
    .eq("tenant_id", tenantId)
    .eq("column_id", columnId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { position?: number } | null)?.position ?? 0) + 1000;
}

/**
 * CRM webhook v2: snapshot + sticky overrides. Does not write custom_field_values.
 */
export async function handleWebhookV2(
  client: Client,
  params: {
    tenantId: string;
    payload: unknown;
  }
): Promise<WebhookV2HttpResult> {
  const validated = validateWebhookV2(params.payload);
  if (!validated.ok) {
    return { httpStatus: 400, body: { error: validated.error } };
  }
  const payload = validated.payload;
  const tenantId = params.tenantId;

  const claim = await claimEventId(client, payload.event_id);
  if (claim === "duplicate") {
    return {
      httpStatus: 200,
      body: { status: "duplicate", skipped: true },
    };
  }

  const { data: existing } = await client
    .from("orders")
    .select(
      "id, crm_updated_at, user_overrides, integration_mode, customer_id, due_date, tag_id, specs, customer:customers(name)"
    )
    .eq("tenant_id", tenantId)
    .eq("crm_order_id", payload.crm_order_id)
    .maybeSingle();

  if (existing) {
    const mode = (existing as { integration_mode?: string | null })
      .integration_mode;
    if (mode === "local" || mode == null) {
      await pruneOldWebhookEvents(client);
      return {
        httpStatus: 200,
        body: { status: "skipped", skipped: true, reason: "local_order" },
      };
    }

    if (
      isStaleCrmUpdate(
        (existing as { crm_updated_at?: string | null }).crm_updated_at,
        payload.crm_updated_at
      )
    ) {
      await pruneOldWebhookEvents(client);
      return {
        httpStatus: 200,
        body: { status: "stale", skipped: true },
      };
    }

    const result = await updateConnectedOrder(client, {
      tenantId,
      orderId: existing.id as string,
      existing: existing as {
        customer_id: string | null;
        due_date: string | null;
        tag_id: string | null;
        specs: Record<string, unknown> | null;
        user_overrides: unknown;
        customer: { name: string } | { name: string }[] | null;
      },
      payload,
    });
    await pruneOldWebhookEvents(client);
    return result;
  }

  const created = await createConnectedOrder(client, {
    tenantId,
    payload,
  });
  await pruneOldWebhookEvents(client);
  return created;
}

async function createConnectedOrder(
  client: Client,
  params: {
    tenantId: string;
    payload: WebhookV2Payload;
  }
): Promise<WebhookV2HttpResult> {
  const { tenantId, payload } = params;
  const column = await firstBoardColumn(client, tenantId);
  if (!column) {
    return {
      httpStatus: 500,
      body: { error: "No board columns configured" },
    };
  }

  const customer = customerFromPayload(payload);
  let customerId: string | null = null;
  if (customer.email || customer.phone) {
    try {
      const upserted = await upsertCustomer(client, tenantId, customer);
      customerId = upserted.customerId;
    } catch (err) {
      console.error(
        "[webhook/v2] customer upsert failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  const owner = await resolveOwner(client, tenantId, payload);

  const orderNumber =
    asTrimmedString(payload.crm_order_number) ?? payload.crm_order_id;
  const productName = firstProductName(payload);
  const position = await nextPosition(client, tenantId, column.id);
  const dueDate = asTrimmedString(payload.due_date);
  const isRush = webhookRushFromPayload(payload) === true;

  const specs: Record<string, unknown> = {
    skus: skusFromLineItems(payload),
    webhook_order_number: orderNumber,
  };
  if (productName) specs.webhook_item_title = productName;
  if (owner.requestOwnerSpecs) {
    Object.assign(specs, owner.requestOwnerSpecs);
  }
  if (isRush) specs.rush = true;

  let tagId: string | null = null;
  if (isRush) {
    const { data: rushTag } = await client
      .from("tags")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", RUSH_ORDER_TAG_NAME)
      .maybeSingle();
    tagId = (rushTag as { id: string } | null)?.id ?? null;
  }

  const { data: order, error } = await client
    .from("orders")
    .insert({
      tenant_id: tenantId,
      column_id: column.id,
      title: orderNumber,
      customer_id: customerId,
      tag_id: tagId,
      priority: "normal",
      due_date: dueDate,
      specs,
      position,
      created_by: owner.ownerId,
      last_moved_at: new Date().toISOString(),
      webhook_source: "crm",
      crm_order_id: payload.crm_order_id,
      crm_updated_at: payload.crm_updated_at,
      crm_snapshot: payload,
      user_overrides: {},
      integration_mode: "connected",
    })
    .select("id")
    .single();

  if (error || !order) {
    return {
      httpStatus: 500,
      body: { error: error?.message ?? "Failed to create order" },
    };
  }

  try {
    await writeActivity(client, {
      tenantId,
      orderId: order.id as string,
      actor: owner.ownerId,
      action: "created",
      metadata: {
        source: "webhook",
        webhook_source: "crm",
        schema_version: 2,
        title: orderNumber,
        column: column.name,
      },
    });
  } catch (err) {
    console.error(
      "[webhook/v2] activity log error:",
      err instanceof Error ? err.message : err
    );
  }

  return {
    httpStatus: 200,
    body: {
      status: "ok",
      action: "created",
      order_id: order.id,
    },
  };
}

function customerNameFromJoin(
  joined: { name: string } | { name: string }[] | null | undefined
): string | null {
  if (!joined) return null;
  const row = Array.isArray(joined) ? joined[0] : joined;
  return asTrimmedString(row?.name);
}

async function updateConnectedOrder(
  client: Client,
  params: {
    tenantId: string;
    orderId: string;
    existing: {
      customer_id: string | null;
      due_date: string | null;
      tag_id: string | null;
      specs: Record<string, unknown> | null;
      user_overrides: unknown;
      customer: { name: string } | { name: string }[] | null;
    };
    payload: WebhookV2Payload;
  }
): Promise<WebhookV2HttpResult> {
  const { tenantId, orderId, existing, payload } = params;
  const overrides = overrideKeysOf(existing.user_overrides);
  const updates: Record<string, unknown> = {
    crm_snapshot: payload,
    crm_updated_at: payload.crm_updated_at,
  };

  const changes: Array<{ field: string; from?: unknown; to?: unknown }> = [
    { field: "Order refreshed from CRM — specifications updated" },
  ];

  const incomingCustomer = customerFromPayload(payload);
  const canUpdateCustomer =
    !overrides.has("customer_name") &&
    !overrides.has("customer_email") &&
    !overrides.has("customer_phone");

  if (canUpdateCustomer && (incomingCustomer.email || incomingCustomer.phone)) {
    const previousName = customerNameFromJoin(existing.customer);
    try {
      const upserted = await upsertCustomer(client, tenantId, {
        ...incomingCustomer,
        existingCustomerId: existing.customer_id,
      }, orderId);
      updates.customer_id = upserted.customerId;
      const nextName = incomingCustomer.name?.trim() || previousName;
      if (
        previousName &&
        nextName &&
        previousName !== nextName &&
        !overrides.has("customer_name")
      ) {
        changes.push({
          field: "CRM updated customer",
          from: previousName,
          to: nextName,
        });
      }
    } catch (err) {
      console.error(
        "[webhook/v2] customer update failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  if (!overrides.has("due_date")) {
    const nextDue = asTrimmedString(payload.due_date);
    const prevDue = existing.due_date
      ? String(existing.due_date).slice(0, 10)
      : null;
    if (nextDue !== prevDue) {
      updates.due_date = nextDue;
      if (prevDue || nextDue) {
        changes.push({
          field: "Due date",
          from: prevDue ?? "",
          to: nextDue ?? "",
        });
      }
    }
  }

  const incomingRush = webhookRushFromPayload(payload);
  if (incomingRush !== undefined && !overrides.has("rush")) {
    const prevRush = existing.specs?.rush === true;
    if (incomingRush !== prevRush) {
      updates.specs = { ...(existing.specs ?? {}), rush: incomingRush };
      changes.push({
        field: "Rush order",
        from: prevRush ? "yes" : "no",
        to: incomingRush ? "yes" : "no",
      });
    }
    if (incomingRush && !existing.tag_id) {
      const { data: rushTag } = await client
        .from("tags")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("name", RUSH_ORDER_TAG_NAME)
        .maybeSingle();
      const tagId = (rushTag as { id: string } | null)?.id ?? null;
      if (tagId) updates.tag_id = tagId;
    }
  }

  const { error } = await client
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { httpStatus: 500, body: { error: error.message } };
  }

  try {
    await writeActivity(client, {
      tenantId,
      orderId,
      actor: null,
      action: "updated",
      metadata: { source: "webhook", webhook_source: "crm", changes },
    });
  } catch (err) {
    console.error(
      "[webhook/v2] activity log error:",
      err instanceof Error ? err.message : err
    );
  }

  return {
    httpStatus: 200,
    body: { status: "ok", action: "updated", order_id: orderId },
  };
}
