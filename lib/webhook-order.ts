import { timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { linkCustomerFromOrderFields } from "@/lib/customers";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import {
  isValidCustomerContact,
  validateDueDate,
} from "@/lib/order-form";
import { prepareSkusForSave, type SkuItem } from "@/lib/skus";
import type { WebhookConfig } from "@/lib/types";

type Client = SupabaseClient;

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const WEBHOOK_CUSTOM_FIELD_MAP: Record<string, string> = {
  product: "Product",
  product_type: "Product Type",
  finished_size: "Finished Size",
  materials: "Materials",
  finishing: "Lamination",
  sides: "Sides",
  color: "Color",
  order_qty: "Order QTY",
};

export interface WebhookOrderPayload {
  customer_name?: string;
  customer_contact?: string;
  customer_phone?: string;
  order_number?: string;
  title?: string;
  priority?: string;
  due_date?: string | null;
  product?: string;
  product_type?: string;
  finished_size?: string;
  materials?: string;
  finishing?: string;
  sides?: string;
  color?: string;
  order_qty?: number | string;
  artwork_url?: string;
  description?: string;
  skus?: {
    sku_name?: string;
    quantity?: number | string;
    artwork_url?: string;
  }[];
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
  }
}

export function secretsMatch(provided: string, stored: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").pop();
    if (base?.trim()) return decodeURIComponent(base);
  } catch {
    // fall through
  }
  return "artwork";
}

function normalizeWebhookSkus(
  raw: WebhookOrderPayload["skus"]
): { skus: SkuItem[]; artworkBySkuId: Map<string, string> } {
  const artworkBySkuId = new Map<string, string>();
  if (!Array.isArray(raw)) {
    return { skus: [], artworkBySkuId };
  }

  const skus: SkuItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name =
      typeof item.sku_name === "string" ? item.sku_name.trim() : "";
    const qtyRaw = item.quantity;
    const qty =
      typeof qtyRaw === "number"
        ? qtyRaw
        : qtyRaw !== undefined && qtyRaw !== null && qtyRaw !== ""
          ? Number(qtyRaw)
          : null;
    const id = crypto.randomUUID();
    if (name || (qty != null && !Number.isNaN(qty))) {
      skus.push({
        id,
        name,
        qty:
          qty != null && !Number.isNaN(qty) && qty >= 1
            ? Math.floor(qty)
            : null,
      });
    }
    if (typeof item.artwork_url === "string" && item.artwork_url.trim()) {
      artworkBySkuId.set(id, item.artwork_url.trim());
    }
  }

  return { skus, artworkBySkuId };
}

function validatePayload(body: WebhookOrderPayload): {
  customerName: string;
  customerContact: string;
} {
  const customerName =
    typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const customerContact =
    (typeof body.customer_contact === "string"
      ? body.customer_contact.trim()
      : "") ||
    (typeof body.customer_phone === "string" ? body.customer_phone.trim() : "");

  if (!customerName) {
    throw new WebhookValidationError("customer_name is required");
  }
  if (!customerContact || !isValidCustomerContact(customerContact)) {
    throw new WebhookValidationError(
      "customer_contact is required (valid email or phone)"
    );
  }

  return { customerName, customerContact };
}

async function resolveCustomFieldIds(
  client: Client,
  tenantId: string
): Promise<Map<string, string>> {
  const names = new Set([
    CUSTOMER_NAME_FIELD_NAME,
    CUSTOMER_CONTACT_FIELD_NAME,
    ...Object.values(WEBHOOK_CUSTOM_FIELD_MAP),
  ]);

  const { data } = await client
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId);

  const byName = new Map<string, string>();
  for (const row of (data ?? []) as { id: string; name: string }[]) {
    if (names.has(row.name)) {
      byName.set(row.name, row.id);
    }
  }
  return byName;
}

function buildCustomFieldValues(
  fieldIds: Map<string, string>,
  body: WebhookOrderPayload,
  customerName: string,
  customerContact: string,
  skus: SkuItem[]
): { customFieldId: string; value: unknown }[] {
  const rows: { customFieldId: string; value: unknown }[] = [];

  const nameId = fieldIds.get(CUSTOMER_NAME_FIELD_NAME);
  const contactId = fieldIds.get(CUSTOMER_CONTACT_FIELD_NAME);
  if (nameId) {
    rows.push({ customFieldId: nameId, value: customerName });
  }
  if (contactId) {
    rows.push({ customFieldId: contactId, value: customerContact });
  }

  for (const [webhookKey, fieldName] of Object.entries(
    WEBHOOK_CUSTOM_FIELD_MAP
  )) {
    const fieldId = fieldIds.get(fieldName);
    if (!fieldId) continue;
    const raw = body[webhookKey as keyof WebhookOrderPayload];
    if (raw === null || raw === undefined || raw === "") continue;
    if (webhookKey === "order_qty") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isNaN(n)) {
        rows.push({ customFieldId: fieldId, value: n });
      }
    } else {
      rows.push({ customFieldId: fieldId, value: String(raw) });
    }
  }

  const orderQtyId = fieldIds.get("Order QTY");
  if (orderQtyId && skus.length > 0) {
    const skuSum = skus.reduce((sum, s) => sum + (s.qty ?? 0), 0);
    if (skuSum > 0) {
      rows.push({ customFieldId: orderQtyId, value: skuSum });
    }
  }

  return rows.filter(
    (v) => v.value !== null && v.value !== undefined && v.value !== ""
  );
}

async function insertExternalAsset(
  client: Client,
  params: {
    tenantId: string;
    orderId: string;
    externalUrl: string;
    skuKey?: string | null;
  }
) {
  const { error } = await client.from("assets").insert({
    tenant_id: params.tenantId,
    order_id: params.orderId,
    sku_key: params.skuKey ?? null,
    file_name: fileNameFromUrl(params.externalUrl),
    storage_path: null,
    external_url: params.externalUrl,
    mime_type: null,
    size: null,
    uploaded_by: null,
  });
  if (error) throw new Error(error.message);
}

export async function createOrderFromWebhook(
  client: Client,
  config: WebhookConfig,
  body: WebhookOrderPayload
): Promise<{ orderId: string; orderNumber: string }> {
  const { customerName, customerContact } = validatePayload(body);

  const priority =
    typeof body.priority === "string" && PRIORITIES.has(body.priority)
      ? body.priority
      : "normal";

  const dueDate =
    typeof body.due_date === "string" && body.due_date.trim()
      ? body.due_date.trim().slice(0, 10)
      : null;
  const dueDateError = validateDueDate(dueDate);
  if (dueDateError) {
    throw new WebhookValidationError(dueDateError);
  }

  const orderNumber =
    (typeof body.order_number === "string" ? body.order_number.trim() : "") ||
    (typeof body.title === "string" ? body.title.trim() : "") ||
    "Webhook Order";

  const description =
    typeof body.description === "string" ? body.description.trim() : null;

  const { skus: rawSkus, artworkBySkuId } = normalizeWebhookSkus(body.skus);
  const skus = prepareSkusForSave(rawSkus);

  const tenantId = config.tenant_id;

  const { data: firstCol } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const columnId = (firstCol as { id: string; name: string } | null)?.id;
  if (!columnId) {
    throw new Error("No columns found for tenant");
  }

  const { data: last } = await client
    .from("orders")
    .select("position")
    .eq("column_id", columnId)
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position =
    ((last as { position: number } | null)?.position ?? 0) + 1000;

  const fieldIds = await resolveCustomFieldIds(client, tenantId);
  const customFieldValues = buildCustomFieldValues(
    fieldIds,
    body,
    customerName,
    customerContact,
    skus
  );

  let customerId: string | null = null;
  if (customFieldValues.length > 0) {
    customerId = await linkCustomerFromOrderFields(
      client,
      tenantId,
      customFieldValues
    );
  }

  const { data: order, error: orderError } = await client
    .from("orders")
    .insert({
      tenant_id: tenantId,
      column_id: columnId,
      title: orderNumber,
      description: description || null,
      customer_id: customerId,
      priority,
      due_date: dueDate,
      specs: { skus },
      position,
      created_by: null,
    })
    .select("id, title")
    .single();

  if (orderError || !order) {
    throw new Error(orderError?.message ?? "Failed to create order");
  }

  const orderId = order.id as string;

  if (customFieldValues.length > 0) {
    const { error: cfvError } = await client.from("custom_field_values").insert(
      customFieldValues.map((v) => ({
        order_id: orderId,
        custom_field_id: v.customFieldId,
        value: v.value,
      }))
    );
    if (cfvError) throw new Error(cfvError.message);
  }

  if (typeof body.artwork_url === "string" && body.artwork_url.trim()) {
    await insertExternalAsset(client, {
      tenantId,
      orderId,
      externalUrl: body.artwork_url.trim(),
    });
  }

  for (const [skuId, url] of artworkBySkuId) {
    await insertExternalAsset(client, {
      tenantId,
      orderId,
      externalUrl: url,
      skuKey: skuId,
    });
  }

  await logActivity(client, {
    tenantId,
    orderId,
    actor: null,
    action: "created",
    metadata: {
      source: "webhook",
      title: order.title,
      column: (firstCol as { name: string } | null)?.name ?? null,
    },
  });

  return { orderId, orderNumber: order.title as string };
}
