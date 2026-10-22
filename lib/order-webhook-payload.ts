import type { OrderExportData } from "@/lib/button-automation-order-data";
import {
  ARTWORK_FIELD_NAME,
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
  DESIGNER_FIELD_NAME,
} from "@/lib/constants";
import { formatNoteHistoryText } from "@/lib/note-history";
import {
  findOrderFormField,
  findOrderQtyField,
  formatFieldDisplayValue,
} from "@/lib/order-form";
import { isApplicationEnabled } from "@/lib/order-application";

/** Stored in `webhook_body_template` when "Send full order card JSON" is enabled. */
export const FULL_ORDER_WEBHOOK_SENTINEL = "__FULL_ORDER_CARD__";
const PULSE_WEBHOOK_HOST = "gkyupebgulpgwugsbvny.supabase.co";
const PULSE_WEBHOOK_PATH = "/functions/v1/receive-job-webhook";

export function isFullOrderWebhookTemplate(
  template: string | null | undefined
): boolean {
  return (template ?? "").trim() === FULL_ORDER_WEBHOOK_SENTINEL;
}

export function isPulseJobWebhookUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === PULSE_WEBHOOK_HOST &&
      parsed.pathname.replace(/\/+$/, "") === PULSE_WEBHOOK_PATH
    );
  } catch {
    return false;
  }
}

/**
 * Pulse rules historically used a hand-written template for integration-only
 * customFields. Keep that block byte-for-byte equivalent while replacing the
 * incomplete top-level payload with the full card payload.
 */
export function preserveRenderedCustomFields(
  fullPayload: Record<string, unknown>,
  renderedTemplate: string
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(renderedTemplate) as Record<string, unknown>;
    const customFields = parsed?.customFields;
    if (
      customFields &&
      typeof customFields === "object" &&
      !Array.isArray(customFields)
    ) {
      return { ...fullPayload, customFields };
    }
  } catch {
    // Invalid legacy templates must not prevent delivery of the full payload.
  }
  return fullPayload;
}

function fieldRaw(
  data: OrderExportData,
  ...names: string[]
): unknown {
  for (const name of names) {
    const field = findOrderFormField(data.customFields, name);
    if (!field) continue;
    const raw = data.fieldValues[field.id];
    if (raw !== null && raw !== undefined && raw !== "") return raw;
  }
  return undefined;
}

function fieldString(data: OrderExportData, ...names: string[]): string {
  const raw = fieldRaw(data, ...names);
  if (raw == null || raw === "") return "";
  return formatFieldDisplayValue(raw).trim();
}

/** Infer finishing from composite product titles like "Roll Labels – White BOPP – Rainbow Holographic Lamination". */
function extractFinishingFromProductText(text: string): string {
  const s = String(text || "").trim();
  if (!s) return "";
  const parts = s
    .split(/\s*[–—]\s*|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const looksLikeFinishing = (part: string) => {
    if (!part) return false;
    if (
      /bopp|vinyl|paper|pet|c1s|c2s|kraft|foil silver|foil gold|cosmetic web|label sheet|semi gloss|matte label|gloss label/i.test(
        part
      ) &&
      !/lamination|laminate|spot\s*uv|scodix|soft\s*touch/i.test(part)
    ) {
      return false;
    }
    return /lamination|laminate|spot\s*uv|soft\s*touch|scodix|\bfoil\b|holographic|holo\b|coating/i.test(
      part
    );
  };
  if (parts.length >= 2) {
    for (let i = parts.length - 1; i >= 1; i--) {
      if (looksLikeFinishing(parts[i])) return parts[i];
    }
  }
  if (parts.length === 1 && looksLikeFinishing(parts[0])) return parts[0];
  return "";
}

function alignSkuNameFinishing(name: string, finishing: string): string {
  const current = extractFinishingFromProductText(name);
  if (
    !current ||
    !finishing ||
    current.toLowerCase() === finishing.toLowerCase()
  ) {
    return name;
  }
  const trimmed = name.trim();
  if (!trimmed.toLowerCase().endsWith(current.toLowerCase())) return name;
  return `${trimmed.slice(0, trimmed.length - current.length)}${finishing}`;
}

function fieldNumber(data: OrderExportData, ...names: string[]): number | null {
  const raw = fieldRaw(data, ...names);
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function fieldBool(data: OrderExportData, ...names: string[]): boolean {
  const raw = fieldRaw(data, ...names);
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return ["true", "yes", "1", "on", "checked"].includes(v);
  }
  return false;
}

function specString(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const value = raw as Record<string, unknown>;
  return (
    specString(value.label) ||
    specString(value.name) ||
    specString(value.value)
  );
}

function resolveActualDie(
  data: OrderExportData,
  specs: Record<string, unknown>,
  cuttingType: string
): string | null {
  const explicitField = fieldString(
    data,
    "Die Number",
    "Die #",
    "Die No",
    "Die Name"
  );
  if (explicitField) return explicitField;

  const selections =
    specs.spec_selections &&
    typeof specs.spec_selections === "object" &&
    !Array.isArray(specs.spec_selections)
      ? (specs.spec_selections as Record<string, unknown>)
      : {};
  for (const key of ["DIE_NUMBER", "DIE_NO", "DIE_NAME", "DIE"]) {
    const value = specString(selections[key]);
    if (value) return value;
  }
  for (const key of ["die_number", "die_no", "die_name", "die"]) {
    const value = specString(specs[key]);
    if (value) return value;
  }

  const genericDie = (data.die || fieldString(data, "Die")).trim();
  if (
    !genericDie ||
    (cuttingType &&
      genericDie.toLowerCase() === cuttingType.toLowerCase())
  ) {
    return null;
  }
  return genericDie;
}

function asIsoDate(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  // Already ISO date / datetime
  if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) {
    return value.trim().slice(0, 10);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function displayPriority(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function resolveFacility(data: OrderExportData): string {
  const explicit = fieldString(data, "Facility", "Plant", "Location");
  const normalized = explicit.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized.includes("boyd")) return "boyd-street";
  if (normalized.includes("16th") || normalized.includes("16-th")) {
    return "16th-street";
  }
  const materials = fieldString(data, "Materials", "Material", "Paper Stock");
  if (/\bboyd\b/i.test(materials)) return "boyd-street";
  return "16th-street";
}

function buildCustomFieldsMap(data: OrderExportData): Record<string, string> {
  const skip = new Set(
    [
      CUSTOMER_NAME_FIELD_NAME,
      CUSTOMER_CONTACT_FIELD_NAME,
      ARTWORK_FIELD_NAME,
      DESIGNER_FIELD_NAME,
      "Category",
      "Product",
      "Materials",
      "Material",
      "Special effects",
      "Finishing",
      "Lamination",
      "Sides",
      "Position",
      "Roll Direction",
      "Color",
      "Color Mode",
      "Die",
      "Width",
      "Height",
      "Finished Size",
      "Application",
      "Die Cut",
      "Perforation",
      "Need a Design",
      "Facility",
      "Plant",
      "Location",
      "Unit Price",
      "Unit Price ($)",
      "Order QTY",
      "Quantity",
    ].map((n) => n.toLowerCase())
  );

  const out: Record<string, string> = {};
  for (const field of data.customFields) {
    if (skip.has(field.name.toLowerCase())) continue;
    const raw = data.fieldValues[field.id];
    out[field.name] =
      raw == null || raw === "" ? "" : formatFieldDisplayValue(raw);
  }
  return out;
}

/**
 * Pulse job-ticket webhook payload.
 * Shape matches receive-job-webhook: only `customer` is required; empties allowed.
 */
export function buildFullOrderWebhookPayload(
  data: OrderExportData,
  _extra?: {
    event?: "order_entered_column" | "order_created" | "order_webhook_test";
    columnId?: string;
    tenantId?: string;
    movedAt?: string;
  }
): Record<string, unknown> {
  const order = data.order;
  const specs =
    order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
      ? (order.specs as Record<string, unknown>)
      : {};

  const qtyField = findOrderQtyField(data.customFields);
  const manualQty =
    qtyField != null ? data.fieldValues[qtyField.id] : undefined;
  let totalQuantity: number | null = data.totalQty;
  if (totalQuantity == null || totalQuantity === 0) {
    if (typeof manualQty === "number" && Number.isFinite(manualQty)) {
      totalQuantity = manualQty;
    } else if (manualQty != null && manualQty !== "") {
      const n = Number(manualQty);
      totalQuantity = Number.isFinite(n) ? n : null;
    }
  }

  const sizeWidth = fieldNumber(data, "Width");
  const sizeHeight = fieldNumber(data, "Height");
  const finishedSize = fieldString(data, "Finished Size");
  let width = sizeWidth;
  let height = sizeHeight;
  if ((width == null || height == null) && finishedSize) {
    const m = finishedSize.match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
    if (m) {
      width = width ?? Number(m[1]);
      height = height ?? Number(m[2]);
    }
  }

  const designTask =
    data.designTask ||
    (typeof specs.design_task === "string" ? specs.design_task.trim() : "");

  const internalNotes = formatNoteHistoryText(order.internal_note);
  const productionNotes =
    formatNoteHistoryText(
      typeof specs.production_notes === "string" ? specs.production_notes : ""
    ) || internalNotes;
  const designerNotes = formatNoteHistoryText(
    typeof specs.designer_notes === "string" ? specs.designer_notes : ""
  );

  // Line-item title (UI “Line 1” / webhook_item_title) — this is the job title for Pulse.
  const itemTitle =
    (typeof specs.webhook_item_title === "string"
      ? specs.webhook_item_title.trim()
      : "") ||
    fieldString(data, "Line 1", "Line item name", "Item Title", "Item title") ||
    "";

  const customer =
    data.customerName === "—" || !data.customerName.trim()
      ? ""
      : data.customerName.trim();

  const color =
    fieldString(data, "Color Mode", "Color") ||
    (typeof specs.color === "string" ? specs.color : "") ||
    null;

  const application =
    isApplicationEnabled(order.specs, data.customFields, data.fieldValues) ||
    fieldBool(data, "Application");

  // Pulse uses orderId (also order_id / orderNumber / order_ref / workflowOrderId)
  // as the job ticket number instead of auto-assigning. Send the board/CRM
  // number (e.g. 0499-1), never the internal UUID.
  const crmOrderId = (data.orderNumber || order.title || "").trim();

  const loadedProduct =
    data.product?.trim().toLowerCase() === "order"
      ? ""
      : data.product?.trim() || "";
  const product =
    loadedProduct ||
    fieldString(data, "Product") ||
    data.skuRows?.[0]?.name.split(/\s*[–—]\s*|\s+-\s+/)[0]?.trim() ||
    "";
  const finishing =
    fieldString(data, "Finishing", "Lamination") ||
    extractFinishingFromProductText(product);
  const accountManager =
    data.ownerName ||
    (typeof specs.request_owner_name === "string"
      ? specs.request_owner_name.trim()
      : "");
  const designer =
    data.designerName ||
    (typeof specs.designer_name === "string"
      ? specs.designer_name.trim()
      : "") ||
    fieldString(data, "Designer");
  const cuttingType =
    typeof specs.cutting_type === "string" ? specs.cutting_type.trim() : "";
  const actualDie = resolveActualDie(data, specs, cuttingType);

  return {
    orderId: crmOrderId,
    order_id: crmOrderId,
    orderNumber: crmOrderId,
    tenantName: data.tenantName || "",
    customer,
    dueDate: asIsoDate(order.due_date),
    priority: displayPriority(
      data.priority && data.priority !== "—" ? data.priority : order.priority
    ),
    accountManager,
    designer,
    totalQuantity,
    category: fieldString(data, "Category"),
    product,
    materials: fieldString(data, "Materials", "Material", "Paper Stock"),
    specialEffects: fieldString(data, "Special effects", "Special Effects"),
    finishing,
    sides: fieldString(data, "Sides") || null,
    position: fieldString(data, "Position"),
    rollDirection: fieldString(data, "Roll Direction"),
    color,
    die: actualDie,
    sizeWidth: width,
    sizeHeight: height,
    application,
    dieCut:
      cuttingType ||
      fieldString(data, "Cut Method", "Cutting", "Cutting Type", "Die Cut") ||
      (fieldBool(data, "Die Cut") ? "Yes" : ""),
    perforation: fieldBool(data, "Perforation"),
    needDesign: fieldBool(data, "Need a Design"),
    customFields: buildCustomFieldsMap(data),
    designFilesLink: /^https?:\/\//i.test(designTask) ? designTask : "",
    artworkLink: data.artworkLink || "",
    // Pulse job title = Line 1 item title (not order.description / designer notes)
    title: itemTitle,
    description: itemTitle || order.description || designerNotes || "",
    productionNotes,
    internalNotes,
    facility: resolveFacility(data),
    skus: (data.skuRows ?? []).map((row) => {
      const files =
        row.imageFiles?.length > 0
          ? row.imageFiles
          : (row.imageLinks ?? []).filter(Boolean).map((url, i) => ({
              name: i === 0 ? "Card artwork" : `Artwork ${i + 1}`,
              url,
            }));
      const links = files.map((f) => f.url);
      return {
        name: alignSkuNameFinishing(row.name || "", finishing),
        quantity: row.qty,
        artworkUrl: links[0] ?? null,
        imageUrl: links[0] ?? null,
        thumbnailUrl: links[1] ?? links[0] ?? null,
        images: links,
        artworkFiles: files,
      };
    }),
    // Every file on the ticket (Pulse may only read artworkUrl on each SKU).
    artworkFiles: (data.skuRows ?? []).flatMap((row) =>
      (row.imageFiles?.length
        ? row.imageFiles
        : (row.imageLinks ?? []).filter(Boolean).map((url, i) => ({
            name: i === 0 ? "Card artwork" : `Artwork ${i + 1}`,
            url,
          }))
      ).map((f) => ({
        name: f.name,
        url: f.url,
        sku: row.name || "",
      }))
    ),
    // Extra Workflow context (ignored by Pulse if unused)
    workflowOrderId: crmOrderId,
    workflowOrderNumber: crmOrderId,
    workflowColumn: data.columnName || "",
    workflowInternalId: order.id || "",
  };
}

export function buildFullOrderWebhookTestPayload(): Record<string, unknown> {
  return {
    orderId: "WF-TEST-001",
    order_id: "WF-TEST-001",
    orderNumber: "WF-TEST-001",
    tenantName: "Workflow Integration Test",
    customer: "Workflow Pulse Test",
    dueDate: "2026-09-01",
    priority: "Normal",
    accountManager: "Workflow Test",
    designer: "",
    totalQuantity: 100,
    category: "Pouches",
    product: "Pouches",
    materials: "Clear BOPP",
    specialEffects: "",
    finishing: "",
    sides: "1-sided",
    position: "",
    rollDirection: "",
    color: "CMYK",
    die: "",
    sizeWidth: 4,
    sizeHeight: 6,
    application: false,
    dieCut: "",
    perforation: false,
    needDesign: false,
    customFields: {
      Source: "Workflow test webhook",
    },
    designFilesLink: "",
    artworkLink: "",
    description: "Test payload from Workflow → Pulse receive-job-webhook.",
    title: "Test Line Item Title",
    productionNotes: "",
    internalNotes: "Safe to delete — Workflow integration test.",
    facility: "16th-street",
    skus: [
      {
        name: "Test SKU",
        quantity: 100,
        artworkUrl: "",
        imageUrl: "",
        thumbnailUrl: "",
        images: [],
        artworkFiles: [],
      },
    ],
    workflowOrderId: "WF-TEST-001",
    workflowOrderNumber: "WF-TEST-001",
    workflowColumn: "Test",
    workflowInternalId: "test",
  };
}
