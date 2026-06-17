import { randomUUID, timingSafeEqual } from "crypto";
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

const SELECT_WEBHOOK_KEYS = new Set([
  "product",
  "product_type",
  "materials",
  "finishing",
  "sides",
  "color",
]);

interface CustomFieldDef {
  id: string;
  name: string;
  field_type: string;
  options: string[];
}

const WEBHOOK_CUSTOM_FIELD_MAP: Record<string, string> = {
  product: "Product",
  product_type: "Product Type",
  finished_size: "Finished Size",
  materials: "Materials",
  finishing: "Finishing",
  sides: "Sides",
  color: "Color",
  order_qty: "Order QTY",
};

/** DB field names that map to a webhook key (handles renames like Finishing ↔ Lamination). */
const WEBHOOK_FIELD_ALIASES: Record<string, string[]> = {
  product: ["Product"],
  product_type: ["Product Type"],
  finished_size: ["Finished Size"],
  materials: ["Materials"],
  finishing: ["Finishing", "Lamination"],
  sides: ["Sides"],
  color: ["Color"],
  order_qty: ["Order QTY"],
};

export interface WebhookSkuPayload {
  sku_name?: string;
  quantity?: number | string;
  artwork_url?: string;
}

export interface WebhookItem {
  title?: string;
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
  skus?: WebhookSkuPayload[];
}

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
  skus?: WebhookSkuPayload[];
  items?: WebhookItem[];
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
  raw: WebhookSkuPayload[] | undefined
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
    const id = randomUUID();
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
    throw new WebhookValidationError("Missing required field: customer_name");
  }
  if (!customerContact || !isValidCustomerContact(customerContact)) {
    throw new WebhookValidationError(
      "Missing required field: customer_contact or customer_phone"
    );
  }

  return { customerName, customerContact };
}

function validateOrderNumber(body: WebhookOrderPayload): string {
  const orderNumber =
    typeof body.order_number === "string" ? body.order_number.trim() : "";
  if (!orderNumber) {
    throw new WebhookValidationError("Missing required field: order_number");
  }
  return orderNumber;
}

function validateDueDateRequired(body: WebhookOrderPayload): string {
  const dueDate =
    typeof body.due_date === "string" && body.due_date.trim()
      ? body.due_date.trim().slice(0, 10)
      : null;
  if (!dueDate) {
    throw new WebhookValidationError("Missing required field: due_date");
  }
  const dueDateError = validateDueDate(dueDate);
  if (dueDateError) {
    throw new WebhookValidationError(dueDateError);
  }
  return dueDate;
}

function validateItemsArray(items: unknown): void {
  if (!Array.isArray(items)) return;
  if (items.length === 0) {
    throw new WebhookValidationError("items array must not be empty");
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") {
      throw new WebhookValidationError(`items[${i}] is invalid`);
    }
  }
}

/** Support both flat fields and an items array. */
export function normalizeItems(body: WebhookOrderPayload): WebhookItem[] {
  if (Array.isArray(body.items) && body.items.length > 0) {
    return body.items;
  }

  return [
    {
      title: body.title,
      product: body.product,
      product_type: body.product_type,
      finished_size: body.finished_size,
      materials: body.materials,
      finishing: body.finishing,
      sides: body.sides,
      color: body.color,
      order_qty: body.order_qty,
      artwork_url: body.artwork_url,
      description: body.description,
      skus: body.skus,
    },
  ];
}

export function resolveItemTitle(
  item: WebhookItem,
  orderTitle: string,
  itemIndex: number,
  totalItems: number
): string {
  if (item.title?.trim()) return item.title.trim();
  if (totalItems === 1) return orderTitle;
  const productLabel = item.product?.trim() || `Item ${itemIndex + 1}`;
  return `${orderTitle} — ${productLabel}`;
}

function resolveOrderLevelTitle(body: WebhookOrderPayload): string {
  return (
    (typeof body.title === "string" ? body.title.trim() : "") ||
    (typeof body.order_number === "string" ? body.order_number.trim() : "")
  );
}

type WebhookSpecFields = Pick<
  WebhookItem,
  | "product"
  | "product_type"
  | "finished_size"
  | "materials"
  | "finishing"
  | "sides"
  | "color"
  | "order_qty"
>;

function parseFieldOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const options: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      options.push(item.trim());
    } else if (
      item &&
      typeof item === "object" &&
      "value" in item &&
      typeof (item as { value: unknown }).value === "string"
    ) {
      const v = (item as { value: string }).value.trim();
      if (v) options.push(v);
    }
  }
  return options;
}

function normalizeOptionText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Match incoming webhook text to a tenant select option (case/whitespace insensitive). */
export function matchSelectOption(
  incoming: string,
  options: string[]
): string {
  const trimmed = incoming.trim().replace(/\s+/g, " ");
  if (!trimmed || options.length === 0) return trimmed;

  const lower = normalizeOptionText(trimmed);

  const exact = options.find(
    (o) => normalizeOptionText(o) === lower
  );
  if (exact) return exact;

  const incomingContains = options
    .filter((o) => o.trim() && lower.includes(normalizeOptionText(o)))
    .sort((a, b) => b.length - a.length);
  if (incomingContains[0]) return incomingContains[0];

  const optionContains = options
    .filter((o) => o.trim() && normalizeOptionText(o).includes(lower))
    .sort((a, b) => a.length - b.length);
  if (optionContains[0]) return optionContains[0];

  return trimmed;
}

function fieldNameMatches(fieldName: string, candidates: string[]): boolean {
  const lower = fieldName.toLowerCase();
  return candidates.some((c) => c.toLowerCase() === lower);
}

async function resolveCustomFields(
  client: Client,
  tenantId: string
): Promise<Map<string, CustomFieldDef>> {
  const { data } = await client
    .from("custom_fields")
    .select("id, name, field_type, options")
    .eq("tenant_id", tenantId);

  const rows = (data ?? []) as {
    id: string;
    name: string;
    field_type: string;
    options: unknown;
  }[];

  const byWebhookKey = new Map<string, CustomFieldDef>();

  for (const [webhookKey, candidates] of Object.entries(WEBHOOK_FIELD_ALIASES)) {
    const row = rows.find((r) => fieldNameMatches(r.name, candidates));
    if (row) {
      byWebhookKey.set(webhookKey, {
        id: row.id,
        name: row.name,
        field_type: row.field_type,
        options: parseFieldOptions(row.options),
      });
    }
  }

  for (const reserved of [
    CUSTOMER_NAME_FIELD_NAME,
    CUSTOMER_CONTACT_FIELD_NAME,
  ] as const) {
    const row = rows.find(
      (r) => r.name.toLowerCase() === reserved.toLowerCase()
    );
    if (row) {
      byWebhookKey.set(reserved, {
        id: row.id,
        name: row.name,
        field_type: row.field_type,
        options: parseFieldOptions(row.options),
      });
    }
  }

  return byWebhookKey;
}

function resolveWebhookFieldValue(
  webhookKey: string,
  raw: unknown,
  field: CustomFieldDef | undefined
): unknown {
  if (raw === null || raw === undefined || raw === "") return null;

  if (webhookKey === "order_qty") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  const text = String(raw).trim();
  if (!text) return null;

  if (
    field?.field_type === "select" &&
    SELECT_WEBHOOK_KEYS.has(webhookKey) &&
    field.options.length > 0
  ) {
    return matchSelectOption(text, field.options);
  }

  return text;
}

function buildCustomFieldValues(
  fields: Map<string, CustomFieldDef>,
  specFields: WebhookSpecFields,
  customerName: string,
  customerContact: string,
  skus: SkuItem[]
): { customFieldId: string; value: unknown }[] {
  const byFieldId = new Map<string, unknown>();

  const nameField = fields.get(CUSTOMER_NAME_FIELD_NAME);
  const contactField = fields.get(CUSTOMER_CONTACT_FIELD_NAME);
  if (nameField) byFieldId.set(nameField.id, customerName);
  if (contactField) byFieldId.set(contactField.id, customerContact);

  const skuQtySum =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + (s.qty ?? 0), 0)
      : 0;

  for (const [webhookKey] of Object.entries(WEBHOOK_CUSTOM_FIELD_MAP)) {
    if (webhookKey === "order_qty" && skus.length > 0 && skuQtySum > 0) {
      continue;
    }
    const field = fields.get(webhookKey);
    if (!field) continue;
    const raw = specFields[webhookKey as keyof WebhookSpecFields];
    const value = resolveWebhookFieldValue(webhookKey, raw, field);
    if (value === null) continue;
    byFieldId.set(field.id, value);
  }

  const orderQtyField = fields.get("order_qty");
  if (orderQtyField && skus.length > 0 && skuQtySum > 0) {
    byFieldId.set(orderQtyField.id, skuQtySum);
  }

  return [...byFieldId.entries()].map(([customFieldId, value]) => ({
    customFieldId,
    value,
  }));
}

async function insertExternalAsset(
  client: Client,
  params: {
    tenantId: string;
    orderId: string;
    externalUrl: string;
    skuKey?: string | null;
  }
): Promise<string | null> {
  const row = {
    tenant_id: params.tenantId,
    order_id: params.orderId,
    sku_key: params.skuKey ?? null,
    file_name: fileNameFromUrl(params.externalUrl),
    storage_path: null,
    external_url: params.externalUrl,
    mime_type: null,
    size: null,
    uploaded_by: null,
  };

  const { error } = await client.from("assets").insert(row);
  if (error) {
    console.error("[webhook/orders] SKU/asset insert error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      sku_key: params.skuKey ?? null,
      order_id: params.orderId,
      row,
    });
    return error.message;
  }
  return null;
}

async function insertCustomFieldValues(
  client: Client,
  orderId: string,
  values: { customFieldId: string; value: unknown }[]
): Promise<string | null> {
  if (values.length === 0) return null;

  const { error } = await client.from("custom_field_values").insert(
    values.map((v) => ({
      order_id: orderId,
      custom_field_id: v.customFieldId,
      value: v.value,
    }))
  );

  if (error) {
    console.error("[webhook/orders] custom_field_values insert error:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      order_id: orderId,
      field_count: values.length,
      values,
    });
    return error.message;
  }

  return null;
}

export interface WebhookCreatedJob {
  order_id: string;
  item_index: number;
  title: string;
}

export interface WebhookOrderResult {
  isMultiItem: false;
  orderId: string;
  orderNumber: string;
  warning?: string;
}

export interface WebhookMultiOrderResult {
  isMultiItem: true;
  orderNumber: string;
  jobs: WebhookCreatedJob[];
  warning?: string;
}

export type WebhookCreateResult = WebhookOrderResult | WebhookMultiOrderResult;

interface CreateSingleJobParams {
  client: Client;
  tenantId: string;
  columnId: string;
  columnName: string | null;
  position: number;
  fields: Map<string, CustomFieldDef>;
  customerId: string | null;
  customerName: string;
  customerContact: string;
  item: WebhookItem;
  priority: string;
  dueDate: string | null;
  orderDescription: string | null;
  cardTitle: string;
  jobTitle: string;
  webhookOrderNumber: string;
  itemIndex: number;
  totalItems: number;
}

async function createSingleWebhookJob(
  params: CreateSingleJobParams
): Promise<{ orderId: string; title: string; warnings: string[] }> {
  const {
    client,
    tenantId,
    columnId,
    columnName,
    position,
    fields,
    customerId,
    customerName,
    customerContact,
    item,
    priority,
    dueDate,
    orderDescription,
    cardTitle,
    jobTitle,
    webhookOrderNumber,
    itemIndex,
    totalItems,
  } = params;

  const { skus: rawSkus, artworkBySkuId } = normalizeWebhookSkus(item.skus);
  const skus = prepareSkusForSave(rawSkus);

  const customFieldValues = buildCustomFieldValues(
    fields,
    item,
    customerName,
    customerContact,
    skus
  );

  const itemDescription =
    typeof item.description === "string" ? item.description.trim() : null;
  const description = itemDescription || orderDescription;

  const specs: Record<string, unknown> = { skus };
  if (totalItems > 1) {
    specs.webhook_order_number = webhookOrderNumber;
    specs.webhook_item_index = itemIndex;
    specs.webhook_item_title = jobTitle;
  }

  const { data: order, error: orderError } = await client
    .from("orders")
    .insert({
      tenant_id: tenantId,
      column_id: columnId,
      title: cardTitle,
      description: description || null,
      customer_id: customerId,
      priority,
      due_date: dueDate,
      specs,
      position,
      created_by: null,
    })
    .select("id, title")
    .single();

  if (orderError || !order) {
    console.error("[webhook/orders] order insert error:", {
      message: orderError?.message,
      code: orderError?.code,
      details: orderError?.details,
      item_index: itemIndex,
      sku_count: skus.length,
    });
    throw new Error(
      orderError?.message ?? `Failed to create job for item ${itemIndex}`
    );
  }

  const orderId = order.id as string;
  const warnings: string[] = [];

  const cfvError = await insertCustomFieldValues(
    client,
    orderId,
    customFieldValues
  );
  if (cfvError) {
    warnings.push(`Custom fields could not be saved: ${cfvError}`);
  }

  if (typeof item.artwork_url === "string" && item.artwork_url.trim()) {
    const assetError = await insertExternalAsset(client, {
      tenantId,
      orderId,
      externalUrl: item.artwork_url.trim(),
    });
    if (assetError) {
      warnings.push(`Order artwork could not be saved: ${assetError}`);
    }
  }

  for (const [skuId, url] of artworkBySkuId) {
    const assetError = await insertExternalAsset(client, {
      tenantId,
      orderId,
      externalUrl: url,
      skuKey: skuId,
    });
    if (assetError) {
      warnings.push(
        `SKU artwork could not be saved (sku ${skuId}): ${assetError}`
      );
    }
  }

  try {
    await logActivity(client, {
      tenantId,
      orderId,
      actor: null,
      action: "created",
      metadata: {
        source: "webhook",
        title: order.title,
        column: columnName,
        ...(totalItems > 1
          ? {
              webhook_order_number: webhookOrderNumber,
              item_index: itemIndex,
            }
          : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Activity log failed";
    console.error("[webhook/orders] activity log error:", message);
    warnings.push(message);
  }

  return {
    orderId,
    title: cardTitle,
    warnings,
  };
}

export async function createOrderFromWebhook(
  client: Client,
  config: WebhookConfig,
  body: WebhookOrderPayload
): Promise<WebhookCreateResult> {
  const { customerName, customerContact } = validatePayload(body);
  validateItemsArray(body.items);
  const baseOrderNumber = validateOrderNumber(body);
  const dueDate = validateDueDateRequired(body);

  const priority =
    typeof body.priority === "string" && PRIORITIES.has(body.priority)
      ? body.priority
      : "normal";

  const isMultiItem = Array.isArray(body.items) && body.items.length > 0;
  const items = normalizeItems(body);
  const orderLevelTitle = resolveOrderLevelTitle(body);
  const orderDescription =
    typeof body.description === "string" ? body.description.trim() : null;

  const tenantId = config.tenant_id;

  const { data: firstCol } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const columnId = (firstCol as { id: string; name: string } | null)?.id;
  const columnName = (firstCol as { id: string; name: string } | null)?.name ?? null;
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
  let nextPosition =
    ((last as { position: number } | null)?.position ?? 0) + 1000;

  const fields = await resolveCustomFields(client, tenantId);
  const customerFieldValues = buildCustomFieldValues(
    fields,
    {},
    customerName,
    customerContact,
    []
  );

  let customerId: string | null = null;
  if (customerFieldValues.length > 0) {
    customerId = await linkCustomerFromOrderFields(
      client,
      tenantId,
      customerFieldValues
    );
  }

  const createdJobs: WebhookCreatedJob[] = [];
  const allWarnings: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const jobTitle = resolveItemTitle(item, orderLevelTitle, i, items.length);
    const cardTitle = isMultiItem
      ? `${baseOrderNumber}-${i + 1}`
      : baseOrderNumber;

    const result = await createSingleWebhookJob({
      client,
      tenantId,
      columnId,
      columnName,
      position: nextPosition,
      fields,
      customerId,
      customerName,
      customerContact,
      item,
      priority,
      dueDate,
      orderDescription,
      cardTitle,
      jobTitle,
      webhookOrderNumber: baseOrderNumber,
      itemIndex: i,
      totalItems: items.length,
    });

    nextPosition += 1000;
    allWarnings.push(...result.warnings);
    createdJobs.push({
      order_id: result.orderId,
      item_index: i,
      title: jobTitle,
    });
  }

  const warning =
    allWarnings.length > 0 ? allWarnings.join("; ") : undefined;

  if (isMultiItem) {
    return {
      isMultiItem: true,
      orderNumber: baseOrderNumber,
      jobs: createdJobs,
      warning,
    };
  }

  return {
    isMultiItem: false,
    orderId: createdJobs[0].order_id,
    orderNumber: baseOrderNumber,
    warning,
  };
}
