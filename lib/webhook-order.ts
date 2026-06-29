import { randomUUID, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/automation";
import { upsertCustomer } from "@/lib/customers";
import { findAuthUserByEmail } from "@/lib/team-members";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import {
  isValidCustomerContact,
  validateDueDate,
} from "@/lib/order-form";
import { prepareSkusForSave, type SkuItem } from "@/lib/skus";
import { normalizeSmsPhone } from "@/lib/sms";
import { fuzzyMatch } from "@/lib/fuzzyMatch";
import {
  filterValidCustomFieldValues,
} from "@/lib/custom-field-values.server";
import { selectOptionsForWebhookField } from "@/lib/webhook-field-options";
import type { WebhookConfig } from "@/lib/types";

type Client = SupabaseClient;

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const SELECT_WEBHOOK_KEYS = new Set([
  "product",
  "materials",
  "finishing",
  "lamination",
  "sides",
  "color",
  "color_mode",
  "position",
]);

const BOOLEAN_WEBHOOK_KEYS = new Set([
  "spot_uv",
  "foil",
  "die_cut",
  "application",
  "need_a_design",
]);

interface CustomFieldDef {
  id: string;
  name: string;
  field_type: string;
  options: string[];
}

const WEBHOOK_CUSTOM_FIELD_MAP: Record<string, string> = {
  product: "Product",
  finished_size: "Finished Size",
  die: "Die",
  materials: "Materials",
  finishing: "Finishing",
  lamination: "Lamination",
  sides: "Sides",
  color: "Color",
  color_mode: "Color Mode",
  position: "Position",
  order_qty: "Order QTY",
  designer_information: "Designer Information",
  spot_uv: "Spot UV",
  foil: "Foil",
  die_cut: "Die Cut",
  application: "Application",
  need_a_design: "Need a Design",
};

/** DB field names that map to a webhook key (handles renames like Finishing ↔ Lamination). */
const WEBHOOK_FIELD_ALIASES: Record<string, string[]> = {
  product: ["Product"],
  finished_size: ["Finished Size"],
  die: ["Die"],
  materials: ["Materials"],
  finishing: ["Finishing", "Lamination"],
  lamination: ["Lamination", "Finishing"],
  sides: ["Sides"],
  color: ["Color"],
  color_mode: ["Color Mode", "Color"],
  position: ["Position"],
  order_qty: ["Order QTY"],
  designer_information: ["Designer Information"],
  spot_uv: ["Spot UV"],
  foil: ["Foil"],
  die_cut: ["Die Cut"],
  application: ["Application"],
  need_a_design: ["Need a Design"],
};

interface WebhookDesignerInput {
  designer_email?: string;
  designer_id?: string;
  designer?: string;
  designer_information?: string;
  designer_notes?: string;
  design_task?: string;
}

export interface WebhookOwnerInput {
  /** Account manager email — sets card Owner (`created_by`). */
  owner_email?: string;
  /** Account manager UUID — sets card Owner (`created_by`). */
  owner_id?: string;
  /** Account manager display name — sets card Owner when matched. */
  owner_name?: string;
  /** Account manager email, UUID, or display name. */
  owner?: string;
  /** Alias for `owner_email` — request submitter / account manager. */
  request_owner_email?: string;
  /** Alias for `owner_id`. */
  request_owner_id?: string;
  /** Alias for `owner`. */
  request_owner?: string;
  /** Free-text request owner name (stored on card when provided). */
  request_owner_name?: string;
  /** Free-text request owner email or contact (stored on card when provided). */
  request_owner_contact?: string;
  /** Free-text request owner phone (stored on card when provided). */
  request_owner_phone?: string;
}

export interface WebhookSkuPayload {
  sku_name?: string;
  quantity?: number | string;
  artwork_url?: string;
}

export interface WebhookItem extends WebhookDesignerInput, WebhookOwnerInput {
  title?: string;
  product?: string;
  finished_size?: string;
  die?: string;
  materials?: string;
  finishing?: string;
  sides?: string;
  color?: string;
  color_mode?: string;
  position?: string;
  roll_direction?: string;
  lamination?: string;
  spot_uv?: boolean;
  foil?: boolean;
  die_cut?: boolean;
  application?: boolean;
  need_a_design?: boolean;
  order_qty?: number | string;
  artwork_url?: string;
  description?: string;
  category?: string;
  category_name?: string;
  skus?: WebhookSkuPayload[];
}

export interface WebhookOrderPayload extends WebhookDesignerInput, WebhookOwnerInput {
  customer_name?: string;
  customer_contact?: string;
  customer_phone?: string;
  order_number?: string;
  title?: string;
  priority?: string;
  due_date?: string | null;
  category?: string;
  category_name?: string;
  product?: string;
  finished_size?: string;
  die?: string;
  materials?: string;
  finishing?: string;
  sides?: string;
  color?: string;
  color_mode?: string;
  position?: string;
  roll_direction?: string;
  lamination?: string;
  spot_uv?: boolean;
  foil?: boolean;
  die_cut?: boolean;
  application?: boolean;
  need_a_design?: boolean;
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

interface WebhookCustomerInfo {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  /** Stored on the order Customer Contact field — phone preferred when both are sent. */
  orderContact: string;
}

function parseWebhookCustomerInfo(body: WebhookOrderPayload): WebhookCustomerInfo {
  const customerName =
    typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const contactRaw =
    typeof body.customer_contact === "string" ? body.customer_contact.trim() : "";
  const phoneRaw =
    typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";

  const customerEmail =
    parseContactEmail(contactRaw) ?? parseContactEmail(phoneRaw);
  const customerPhone =
    parseContactPhone(phoneRaw) ?? parseContactPhone(contactRaw);

  return {
    customerName,
    customerEmail,
    customerPhone,
    orderContact: customerPhone ?? customerEmail ?? "",
  };
}

function resolveOrderNumber(body: WebhookOrderPayload): string {
  const orderNumber =
    typeof body.order_number === "string" ? body.order_number.trim() : "";
  if (orderNumber) return orderNumber;
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `WH-${stamp}-${randomUUID().slice(0, 8)}`;
}

function resolveDueDate(body: WebhookOrderPayload): string | null {
  const dueDate =
    typeof body.due_date === "string" && body.due_date.trim()
      ? body.due_date.trim().slice(0, 10)
      : null;
  if (!dueDate) return null;
  const dueDateError = validateDueDate(dueDate);
  if (dueDateError) {
    throw new WebhookValidationError(dueDateError);
  }
  return dueDate;
}

function parseContactEmail(raw: string): string | null {
  const value = raw.trim();
  if (!value || !value.includes("@")) return null;
  return isValidCustomerContact(value) ? value.toLowerCase() : null;
}

function parseContactPhone(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.includes("@")) return null;
  return isValidCustomerContact(value) ? normalizeSmsPhone(value) : null;
}

function validateItemsArray(items: unknown): void {
  if (!Array.isArray(items)) return;
  // Empty items[] falls back to legacy single-item handling.
  if (items.length === 0) return;
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
      finished_size: body.finished_size,
      die: body.die,
      materials: body.materials,
      finishing: body.finishing,
      sides: body.sides,
      color: body.color ?? body.color_mode,
      color_mode: body.color_mode,
      position: body.position ?? body.roll_direction,
      roll_direction: body.roll_direction,
      lamination: body.lamination,
      spot_uv: body.spot_uv,
      foil: body.foil,
      die_cut: body.die_cut,
      application: body.application,
      need_a_design: body.need_a_design,
      order_qty: body.order_qty,
      artwork_url: body.artwork_url,
      description: body.description,
      skus: body.skus,
      designer_email: body.designer_email,
      designer_id: body.designer_id,
      designer: body.designer,
      designer_information: body.designer_information,
      designer_notes: body.designer_notes,
      design_task: body.design_task,
      owner_email: body.owner_email,
      owner_id: body.owner_id,
      owner_name: body.owner_name,
      owner: body.owner,
      request_owner_email: body.request_owner_email,
      request_owner_id: body.request_owner_id,
      request_owner: body.request_owner,
      request_owner_name: body.request_owner_name,
      request_owner_contact: body.request_owner_contact,
      request_owner_phone: body.request_owner_phone,
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
  | "finished_size"
  | "die"
  | "materials"
  | "finishing"
  | "lamination"
  | "sides"
  | "color"
  | "color_mode"
  | "position"
  | "order_qty"
  | "designer_information"
  | "spot_uv"
  | "foil"
  | "die_cut"
  | "application"
  | "need_a_design"
>;

function resolveDesignNotes(input: WebhookDesignerInput): string | null {
  for (const key of [
    "designer_information",
    "designer_notes",
    "design_task",
  ] as const) {
    const raw = input[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function mergeItemWithOrder(
  order: WebhookOrderPayload,
  item: WebhookItem
): WebhookItem {
  return {
    ...item,
    product: item.product ?? order.product,
    finished_size: item.finished_size ?? order.finished_size,
    die: item.die ?? order.die,
    materials: item.materials ?? order.materials,
    finishing: item.finishing ?? item.lamination ?? order.finishing ?? order.lamination,
    lamination: item.lamination ?? item.finishing ?? order.lamination ?? order.finishing,
    sides: item.sides ?? order.sides,
    color: item.color ?? order.color,
    color_mode: item.color_mode ?? item.color ?? order.color_mode ?? order.color,
    position: item.position ?? item.roll_direction ?? order.position ?? order.roll_direction,
    roll_direction: item.roll_direction ?? order.roll_direction,
    spot_uv: item.spot_uv ?? order.spot_uv,
    foil: item.foil ?? order.foil,
    die_cut: item.die_cut ?? order.die_cut,
    application: item.application ?? order.application,
    need_a_design: item.need_a_design ?? order.need_a_design,
    order_qty: item.order_qty ?? order.order_qty,
    artwork_url: item.artwork_url ?? order.artwork_url,
    description: item.description ?? order.description,
    category: item.category ?? order.category,
    category_name: item.category_name ?? order.category_name,
    designer_email: item.designer_email ?? order.designer_email,
    designer_id: item.designer_id ?? order.designer_id,
    designer: item.designer ?? order.designer,
    designer_information: item.designer_information ?? order.designer_information,
    designer_notes: item.designer_notes ?? order.designer_notes,
    design_task: item.design_task ?? order.design_task,
    owner_email: item.owner_email ?? order.owner_email,
    owner_id: item.owner_id ?? order.owner_id,
    owner_name: item.owner_name ?? order.owner_name,
    owner: item.owner ?? order.owner,
    request_owner_email: item.request_owner_email ?? order.request_owner_email,
    request_owner_id: item.request_owner_id ?? order.request_owner_id,
    request_owner: item.request_owner ?? order.request_owner,
    request_owner_name: item.request_owner_name ?? order.request_owner_name,
    request_owner_contact:
      item.request_owner_contact ?? order.request_owner_contact,
    request_owner_phone: item.request_owner_phone ?? order.request_owner_phone,
  };
}

function mergeOwnerInput(
  order: WebhookOrderPayload,
  item: WebhookItem
): WebhookOwnerInput {
  const merged = mergeItemWithOrder(order, item);
  return {
    owner_email: merged.owner_email ?? merged.request_owner_email,
    owner_id: merged.owner_id ?? merged.request_owner_id,
    owner: merged.owner ?? merged.request_owner,
    request_owner_email: merged.request_owner_email,
    request_owner_id: merged.request_owner_id,
    request_owner: merged.request_owner,
    request_owner_name: merged.request_owner_name,
    request_owner_contact: merged.request_owner_contact,
    request_owner_phone: merged.request_owner_phone,
  };
}

function normalizedOwnerLookup(input: WebhookOwnerInput): {
  owner_id: string;
  owner_email: string;
  owner: string;
} {
  return {
    owner_id:
      (typeof input.owner_id === "string" ? input.owner_id.trim() : "") ||
      (typeof input.request_owner_id === "string"
        ? input.request_owner_id.trim()
        : ""),
    owner_email:
      (typeof input.owner_email === "string" ? input.owner_email.trim() : "") ||
      (typeof input.request_owner_email === "string"
        ? input.request_owner_email.trim()
        : ""),
    owner:
      (typeof input.owner === "string" ? input.owner.trim() : "") ||
      (typeof input.owner_name === "string" ? input.owner_name.trim() : "") ||
      (typeof input.request_owner === "string"
        ? input.request_owner.trim()
        : ""),
  };
}

function buildRequestOwnerSpecs(
  input: WebhookOwnerInput,
  resolved: {
    ownerName: string | null;
    ownerEmail: string | null;
  }
): Record<string, string> {
  const specs: Record<string, string> = {};
  const name =
    (typeof input.request_owner_name === "string"
      ? input.request_owner_name.trim()
      : "") || resolved.ownerName?.trim() || "";
  const email =
    (typeof input.request_owner_contact === "string"
      ? input.request_owner_contact.trim()
      : "") ||
    (typeof input.request_owner_email === "string"
      ? input.request_owner_email.trim()
      : "") ||
    resolved.ownerEmail?.trim() ||
    "";
  const phone =
    typeof input.request_owner_phone === "string"
      ? input.request_owner_phone.trim()
      : "";

  if (name) specs.request_owner_name = name;
  if (email) specs.request_owner_email = email;
  if (phone) specs.request_owner_phone = phone;
  return specs;
}

function mergeDesignerInput(
  order: WebhookOrderPayload,
  item: WebhookItem
): WebhookDesignerInput {
  return {
    designer_email: item.designer_email ?? order.designer_email,
    designer_id: item.designer_id ?? order.designer_id,
    designer: item.designer ?? order.designer,
    designer_information:
      item.designer_information ?? order.designer_information,
    designer_notes: item.designer_notes ?? order.designer_notes,
    design_task: item.design_task ?? order.design_task,
  };
}

function normalizeSpecFields(item: WebhookItem): WebhookSpecFields {
  return {
    product: item.product,
    finished_size: item.finished_size,
    die: item.die,
    materials: item.materials,
    finishing: item.finishing ?? item.lamination,
    lamination: item.lamination ?? item.finishing,
    sides: item.sides,
    color: item.color,
    color_mode: item.color_mode ?? item.color,
    position: item.position ?? item.roll_direction,
    order_qty: item.order_qty,
    designer_information: resolveDesignNotes(item) ?? undefined,
    spot_uv: item.spot_uv,
    foil: item.foil,
    die_cut: item.die_cut,
    application: item.application,
    need_a_design: item.need_a_design,
  };
}

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


/** Fuzzy-resolve a webhook value against tenant select options. */
function resolveSelectField(
  value: string,
  options: string[],
  fieldName: string,
  corrections: string[]
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (options.includes(trimmed)) return trimmed;

  const match = fuzzyMatch(trimmed, options);
  if (match) {
    if (match.score < 1) {
      corrections.push(
        `"${fieldName}": "${trimmed}" → "${match.matched}" (${Math.round(match.score * 100)}% match)`
      );
    }
    return match.matched;
  }

  corrections.push(`"${fieldName}": "${trimmed}" — no match found, left blank`);
  return null;
}

/** Match incoming webhook text to a tenant select option (case/whitespace insensitive). */
export function matchSelectOption(
  incoming: string,
  options: string[]
): string | null {
  return fuzzyMatch(incoming, options)?.matched ?? null;
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
  field: CustomFieldDef | undefined,
  corrections: string[]
): unknown {
  if (BOOLEAN_WEBHOOK_KEYS.has(webhookKey)) {
    return typeof raw === "boolean" ? raw : null;
  }

  if (raw === null || raw === undefined || raw === "") return null;

  if (webhookKey === "order_qty") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  const text = String(raw).trim();
  if (!text) return null;

  if (
    field?.field_type === "select" &&
    SELECT_WEBHOOK_KEYS.has(webhookKey)
  ) {
    const options = selectOptionsForWebhookField(webhookKey, field.options);
    if (options.length > 0) {
      return resolveSelectField(text, options, webhookKey, corrections);
    }
  }

  return text;
}

function buildCustomFieldValues(
  fields: Map<string, CustomFieldDef>,
  specFields: WebhookSpecFields,
  customerName: string,
  orderContact: string,
  skus: SkuItem[],
  corrections: string[]
): { customFieldId: string; value: unknown }[] {
  const byFieldId = new Map<string, unknown>();

  const nameField = fields.get(CUSTOMER_NAME_FIELD_NAME);
  const contactField = fields.get(CUSTOMER_CONTACT_FIELD_NAME);
  if (nameField && customerName) byFieldId.set(nameField.id, customerName);
  if (contactField && orderContact) byFieldId.set(contactField.id, orderContact);

  const skuQtySum =
    skus.length > 0
      ? skus.reduce((sum, s) => sum + (s.qty ?? 0), 0)
      : 0;

  for (const [webhookKey] of Object.entries(WEBHOOK_CUSTOM_FIELD_MAP)) {
    if (webhookKey === "color" && specFields.color_mode) continue;
    if (webhookKey === "finishing" && specFields.lamination) continue;
    if (webhookKey === "order_qty" && skus.length > 0 && skuQtySum > 0) {
      continue;
    }
    const field = fields.get(webhookKey);
    if (!field) continue;
    const raw = specFields[webhookKey as keyof WebhookSpecFields];
    const value = resolveWebhookFieldValue(webhookKey, raw, field, corrections);
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
  tenantId: string,
  orderId: string,
  values: { customFieldId: string; value: unknown }[]
): Promise<string | null> {
  if (values.length === 0) return null;

  const { valid, invalidIds } = await filterValidCustomFieldValues(
    client,
    tenantId,
    values
  );
  if (invalidIds.length > 0) {
    console.error("[webhook/orders] skipping stale custom field ids:", {
      order_id: orderId,
      invalid_ids: invalidIds,
    });
  }
  if (valid.length === 0) return null;

  const { error } = await client.from("custom_field_values").insert(
    valid.map((v) => ({
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
      field_count: valid.length,
      values: valid,
    });
    return error.message;
  }

  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tenantMemberIds(
  client: Client,
  tenantId: string
): Promise<string[]> {
  const { data } = await client
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId);
  return (data ?? []).map((row) => row.user_id as string);
}

async function isTenantMember(
  client: Client,
  tenantId: string,
  userId: string
): Promise<boolean> {
  const { data } = await client
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function profileName(
  client: Client,
  userId: string
): Promise<string | null> {
  const { data } = await client
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const name = (data as { full_name: string | null } | null)?.full_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

async function resolveOwnerByDisplayName(
  client: Client,
  tenantId: string,
  name: string
): Promise<{ userId: string; ownerName: string } | null> {
  const memberIds = await tenantMemberIds(client, tenantId);
  if (memberIds.length === 0) return null;

  const { data: profiles } = await client
    .from("profiles")
    .select("id, full_name")
    .in("id", memberIds);

  const normalized = name.trim().toLowerCase();
  const rows = (profiles ?? []) as { id: string; full_name: string | null }[];

  const exact = rows.find(
    (p) => p.full_name?.trim().toLowerCase() === normalized
  );
  if (exact) {
    return {
      userId: exact.id,
      ownerName: exact.full_name?.trim() ?? name.trim(),
    };
  }

  const partial = rows.filter(
    (p) =>
      p.full_name?.trim() &&
      p.full_name.trim().toLowerCase().includes(normalized)
  );
  if (partial.length === 1) {
    return {
      userId: partial[0].id,
      ownerName: partial[0].full_name?.trim() ?? name.trim(),
    };
  }

  return null;
}

async function memberHasDesignerRole(
  client: Client,
  tenantId: string,
  userId: string
): Promise<boolean> {
  const { data } = await client
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as { role: string } | null)?.role === "designer";
}

async function profileEmail(
  client: Client,
  userId: string
): Promise<string | null> {
  try {
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error || !data.user) return null;
    return data.user.email ?? null;
  } catch {
    return null;
  }
}

async function ensureAccountManagerOwner(
  client: Client,
  tenantId: string,
  userId: string,
  displayName: string | null,
  email: string | null
): Promise<{
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  warning?: string;
}> {
  const memberIds = await tenantMemberIds(client, tenantId);
  if (!memberIds.includes(userId)) {
    return {
      ownerId: null,
      ownerName: displayName,
      ownerEmail: email,
      warning:
        "Request owner is not a team member — Owner field left unassigned",
    };
  }
  return {
    ownerId: userId,
    ownerName: displayName,
    ownerEmail: email,
  };
}

export async function resolveWebhookOwner(
  client: Client,
  tenantId: string,
  input: WebhookOwnerInput
): Promise<{
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  requestOwnerSpecs: Record<string, string>;
  warning?: string;
}> {
  const { owner_id: ownerIdRaw, owner_email: ownerEmailRaw, owner: ownerRaw } =
    normalizedOwnerLookup(input);

  const requestOwnerSpecs = buildRequestOwnerSpecs(input, {
    ownerName: null,
    ownerEmail: null,
  });

  if (!ownerIdRaw && !ownerEmailRaw && !ownerRaw) {
    return {
      ownerId: null,
      ownerName: null,
      ownerEmail: null,
      requestOwnerSpecs,
    };
  }

  if (ownerIdRaw) {
    if (!UUID_RE.test(ownerIdRaw)) {
      return {
        ownerId: null,
        ownerName: null,
        ownerEmail: null,
        requestOwnerSpecs,
        warning: "Invalid request owner id — Owner field left unassigned",
      };
    }
    if (!(await isTenantMember(client, tenantId, ownerIdRaw))) {
      return {
        ownerId: null,
        ownerName: null,
        ownerEmail: null,
        requestOwnerSpecs,
        warning: "Unknown request owner id — Owner field left unassigned",
      };
    }
    const [name, email] = await Promise.all([
      profileName(client, ownerIdRaw),
      profileEmail(client, ownerIdRaw),
    ]);
    const resolved = await ensureAccountManagerOwner(
      client,
      tenantId,
      ownerIdRaw,
      name,
      email
    );
    return {
      ...resolved,
      requestOwnerSpecs: buildRequestOwnerSpecs(input, {
        ownerName: resolved.ownerName,
        ownerEmail: resolved.ownerEmail,
      }),
    };
  }

  const email = (ownerEmailRaw || (ownerRaw.includes("@") ? ownerRaw : ""))
    .trim()
    .toLowerCase();
  if (email) {
    const user = await findAuthUserByEmail(
      client as Parameters<typeof findAuthUserByEmail>[0],
      email
    );
    if (!user) {
      return {
        ownerId: null,
        ownerName: null,
        ownerEmail: email,
        requestOwnerSpecs: buildRequestOwnerSpecs(input, {
          ownerName: null,
          ownerEmail: email,
        }),
      };
    }
    if (!(await isTenantMember(client, tenantId, user.id))) {
      return {
        ownerId: null,
        ownerName: null,
        ownerEmail: email,
        requestOwnerSpecs: buildRequestOwnerSpecs(input, {
          ownerName: null,
          ownerEmail: email,
        }),
        warning:
          "request_owner_email is not a workspace member — Owner field left unassigned",
      };
    }
    const resolved = await ensureAccountManagerOwner(
      client,
      tenantId,
      user.id,
      (await profileName(client, user.id)) ?? user.email ?? null,
      user.email ?? email
    );
    return {
      ...resolved,
      requestOwnerSpecs: buildRequestOwnerSpecs(input, {
        ownerName: resolved.ownerName,
        ownerEmail: resolved.ownerEmail ?? email,
      }),
      warning: resolved.warning,
    };
  }

  const generic = ownerRaw;
  if (UUID_RE.test(generic)) {
    if (!(await isTenantMember(client, tenantId, generic))) {
      return {
        ownerId: null,
        ownerName: null,
        ownerEmail: null,
        requestOwnerSpecs,
        warning: "Unknown request owner — Owner field left unassigned",
      };
    }
    const [name, resolvedEmail] = await Promise.all([
      profileName(client, generic),
      profileEmail(client, generic),
    ]);
    const resolved = await ensureAccountManagerOwner(
      client,
      tenantId,
      generic,
      name,
      resolvedEmail
    );
    return {
      ...resolved,
      requestOwnerSpecs: buildRequestOwnerSpecs(input, {
        ownerName: resolved.ownerName,
        ownerEmail: resolved.ownerEmail,
      }),
    };
  }

  const byName = await resolveOwnerByDisplayName(client, tenantId, generic);
  if (byName) {
    const resolvedEmail = await profileEmail(client, byName.userId);
    const resolved = await ensureAccountManagerOwner(
      client,
      tenantId,
      byName.userId,
      byName.ownerName,
      resolvedEmail
    );
    return {
      ...resolved,
      requestOwnerSpecs: buildRequestOwnerSpecs(input, {
        ownerName: resolved.ownerName ?? byName.ownerName,
        ownerEmail: resolved.ownerEmail,
      }),
    };
  }

  return {
    ownerId: null,
    ownerName: null,
    ownerEmail: null,
    requestOwnerSpecs,
    warning: `Request owner "${generic}" not found — Owner field left unassigned`,
  };
}

export async function resolveWebhookDesigner(
  client: Client,
  tenantId: string,
  input: WebhookDesignerInput
): Promise<{
  designerId: string | null;
  designerName: string | null;
  warning?: string;
}> {
  const designerIdRaw =
    typeof input.designer_id === "string" ? input.designer_id.trim() : "";
  const designerEmailRaw =
    typeof input.designer_email === "string" ? input.designer_email.trim() : "";
  const designerRaw =
    typeof input.designer === "string" ? input.designer.trim() : "";

  if (!designerIdRaw && !designerEmailRaw && !designerRaw) {
    return { designerId: null, designerName: null };
  }

  async function ensureDesignerRole(
    userId: string,
    displayName: string | null
  ): Promise<{
    designerId: string | null;
    designerName: string | null;
    warning?: string;
  }> {
    if (!(await memberHasDesignerRole(client, tenantId, userId))) {
      return {
        designerId: null,
        designerName: null,
        warning: "Designer is not assigned the Designer role — left unassigned",
      };
    }
    return {
      designerId: userId,
      designerName: displayName,
    };
  }

  if (designerIdRaw) {
    if (!UUID_RE.test(designerIdRaw)) {
      return {
        designerId: null,
        designerName: null,
        warning: "Invalid designer_id — designer left unassigned",
      };
    }
    if (!(await isTenantMember(client, tenantId, designerIdRaw))) {
      return {
        designerId: null,
        designerName: null,
        warning: "Unknown designer_id — designer left unassigned",
      };
    }
    return ensureDesignerRole(
      designerIdRaw,
      (await profileName(client, designerIdRaw)) ?? null
    );
  }

  const email = (
    designerEmailRaw || (designerRaw.includes("@") ? designerRaw : "")
  )
    .trim()
    .toLowerCase();
  if (email) {
    const user = await findAuthUserByEmail(
      client as Parameters<typeof findAuthUserByEmail>[0],
      email
    );
    if (!user) {
      return {
        designerId: null,
        designerName: null,
        warning: `Unknown designer_email (${email}) — designer left unassigned`,
      };
    }
    if (!(await isTenantMember(client, tenantId, user.id))) {
      return {
        designerId: null,
        designerName: null,
        warning:
          "designer_email is not a workspace member — designer left unassigned",
      };
    }
    return ensureDesignerRole(
      user.id,
      (await profileName(client, user.id)) ?? user.email ?? null
    );
  }

  const generic = designerRaw;
  if (UUID_RE.test(generic)) {
    if (!(await isTenantMember(client, tenantId, generic))) {
      return {
        designerId: null,
        designerName: null,
        warning: "Unknown designer — designer left unassigned",
      };
    }
    return ensureDesignerRole(
      generic,
      (await profileName(client, generic)) ?? null
    );
  }

  const byName = await resolveOwnerByDisplayName(client, tenantId, generic);
  if (byName) {
    return ensureDesignerRole(byName.userId, byName.ownerName);
  }

  return {
    designerId: null,
    designerName: null,
    warning: `Designer "${generic}" not found — designer left unassigned`,
  };
}

async function resolveCategoryId(
  client: Client,
  tenantId: string,
  name: string | undefined | null
): Promise<string | null> {
  if (typeof name !== "string" || !name.trim()) return null;
  const { data: cat } = await client
    .from("categories")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", name.trim())
    .maybeSingle();
  return (cat as { id: string } | null)?.id ?? null;
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
  ownerId: string | null;
  ownerName: string | null;
  warning?: string;
}

export interface WebhookMultiOrderResult {
  isMultiItem: true;
  orderNumber: string;
  jobs: WebhookCreatedJob[];
  ownerId: string | null;
  ownerName: string | null;
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
  orderContact: string;
  item: WebhookItem;
  priority: string;
  dueDate: string | null;
  orderDescription: string | null;
  cardTitle: string;
  jobTitle: string;
  webhookOrderNumber: string;
  itemIndex: number;
  totalItems: number;
  categoryId: string | null;
  ownerId: string | null;
  requestOwnerSpecs: Record<string, string>;
  designerId: string | null;
  designerName: string | null;
  designNotes: string | null;
  corrections: string[];
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
    orderContact,
    item,
    priority,
    dueDate,
    orderDescription,
    cardTitle,
    jobTitle,
    webhookOrderNumber,
    itemIndex,
    totalItems,
    categoryId,
    ownerId,
    requestOwnerSpecs,
    designerId,
    designerName,
    designNotes,
    corrections,
  } = params;

  const { skus: rawSkus, artworkBySkuId } = normalizeWebhookSkus(item.skus);
  const skus = prepareSkusForSave(rawSkus);

  const specFields = normalizeSpecFields(item);
  if (designNotes) {
    specFields.designer_information = designNotes;
  }

  const customFieldValues = buildCustomFieldValues(
    fields,
    specFields,
    customerName,
    orderContact,
    skus,
    corrections
  );

  const itemDescription =
    typeof item.description === "string" ? item.description.trim() : null;
  const description = itemDescription || orderDescription;

  const specs: Record<string, unknown> = { skus, ...requestOwnerSpecs };
  if (designerId) specs.designer_id = designerId;
  if (designerName) specs.designer_name = designerName;
  if (designNotes) specs.design_task = designNotes;
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
      category_id: categoryId,
      priority,
      due_date: dueDate,
      specs,
      position,
      created_by: ownerId,
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
    tenantId,
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
      actor: ownerId,
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
  const customerInfo = parseWebhookCustomerInfo(body);
  validateItemsArray(body.items);
  const baseOrderNumber = resolveOrderNumber(body);
  const dueDate = resolveDueDate(body);

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

  let customerId: string | null = null;
  if (customerInfo.customerEmail || customerInfo.customerPhone) {
    try {
      const { customerId: id } = await upsertCustomer(client, tenantId, {
        name: customerInfo.customerName,
        email: customerInfo.customerEmail,
        phone: customerInfo.customerPhone,
      });
      customerId = id;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save customer";
      console.error("[webhook/orders] customer upsert error:", message);
    }
  }

  const createdJobs: WebhookCreatedJob[] = [];
  const allWarnings: string[] = [];
  const allCorrections: string[] = [];
  let responseOwnerId: string | null = null;
  let responseOwnerName: string | null = null;

  const orderCategoryName = body.category ?? body.category_name;
  const defaultCategoryId = await resolveCategoryId(
    client,
    tenantId,
    orderCategoryName
  );

  for (let i = 0; i < items.length; i++) {
    const item = mergeItemWithOrder(body, items[i]);
    const jobTitle = resolveItemTitle(item, orderLevelTitle, i, items.length);
    const cardTitle = isMultiItem
      ? `${baseOrderNumber}-${i + 1}`
      : baseOrderNumber;

    const itemCategoryName = item.category ?? item.category_name;
    const categoryId = itemCategoryName
      ? await resolveCategoryId(client, tenantId, itemCategoryName)
      : defaultCategoryId;

    const designerInput = mergeDesignerInput(body, item);
    const {
      designerId,
      designerName,
      warning: designerWarning,
    } = await resolveWebhookDesigner(client, tenantId, designerInput);
    if (designerWarning) allWarnings.push(designerWarning);

    const ownerInput = mergeOwnerInput(body, item);
    const {
      ownerId,
      ownerName,
      requestOwnerSpecs,
      warning: ownerWarning,
    } = await resolveWebhookOwner(client, tenantId, ownerInput);
    if (ownerWarning) allWarnings.push(ownerWarning);
    if (responseOwnerId === null && ownerId) {
      responseOwnerId = ownerId;
    }
    if (responseOwnerName === null && ownerName) {
      responseOwnerName = ownerName;
    }

    const result = await createSingleWebhookJob({
      client,
      tenantId,
      columnId,
      columnName,
      position: nextPosition,
      fields,
      customerId,
      customerName: customerInfo.customerName,
      orderContact: customerInfo.orderContact,
      item,
      priority,
      dueDate,
      orderDescription,
      cardTitle,
      jobTitle,
      webhookOrderNumber: baseOrderNumber,
      itemIndex: i,
      totalItems: items.length,
      categoryId,
      ownerId,
      requestOwnerSpecs,
      designerId,
      designerName,
      designNotes: resolveDesignNotes(designerInput),
      corrections: allCorrections,
    });

    nextPosition += 1000;
    allWarnings.push(...result.warnings);
    createdJobs.push({
      order_id: result.orderId,
      item_index: i,
      title: jobTitle,
    });
  }

  if (allCorrections.length > 0) {
    allWarnings.push(
      `Auto-corrected fields: ${allCorrections.join("; ")}`
    );
  }

  const warning =
    allWarnings.length > 0 ? allWarnings.join("; ") : undefined;

  if (isMultiItem) {
    return {
      isMultiItem: true,
      orderNumber: baseOrderNumber,
      jobs: createdJobs,
      ownerId: responseOwnerId,
      ownerName: responseOwnerName,
      warning,
    };
  }

  return {
    isMultiItem: false,
    orderId: createdJobs[0].order_id,
    orderNumber: baseOrderNumber,
    ownerId: responseOwnerId,
    ownerName: responseOwnerName,
    warning,
  };
}
