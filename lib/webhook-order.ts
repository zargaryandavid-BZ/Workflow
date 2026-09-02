import { randomUUID, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity, resolveColumnForNewJobByProduct } from "@/lib/automation";
import {
  pickColumnByName,
  pickMissingInfoColumn,
} from "@/lib/missing-info-column";
import {
  normalizeSourceChannel,
  shouldApplyMissingInfoFallback,
} from "@/lib/source-channel";
import { upsertCustomer, getCustomerDefaultPriorityScore } from "@/lib/customers";
import { findAuthUserByEmail } from "@/lib/team-members";
import {
  CUSTOMER_CONTACT_FIELD_NAME,
  CUSTOMER_NAME_FIELD_NAME,
} from "@/lib/constants";
import {
  isValidCustomerContact,
  validateDueDate,
} from "@/lib/order-form";
import { prepareSkusForSave, normalizeSkus, type SkuItem } from "@/lib/skus";
import { normalizeSmsPhone } from "@/lib/sms";
import { fuzzyMatch } from "@/lib/fuzzyMatch";
import {
  filterValidCustomFieldValues,
} from "@/lib/custom-field-values.server";
import { selectOptionsForWebhookField } from "@/lib/webhook-field-options";
import {
  RUSH_ORDER_TAG_NAME,
  webhookRushFromPayload,
} from "@/lib/order-rush";
import {
  DIE_REQUEST_TAG_NAME,
  ensureNamedTag,
} from "@/lib/tags";
import {
  firstMatchingTagId,
  webhookItemTagHaystack,
} from "@/lib/tag-exact-word";
import {
  canonicalizeWebhookSourceKey,
  parseWebhookSourceKey,
} from "@/lib/webhook-source-styles";
import {
  hasBillingInfo,
  parseWebhookBilling,
  type OrderBillingInfo,
} from "@/lib/order-billing";
import {
  attachGdriveFoldersToOrders,
  linkExistingDriveFolderToOrder,
} from "@/lib/order-gdrive";
import { resolveWebhookLineFolderUrl } from "@/lib/webhook-line-folder";
import { categoryForProduct, isCatchAllCategory } from "@/lib/product-data";
import { findMatchingOption } from "@/lib/field-links";
import {
  isAdminCatalogLine,
  mapWebhookSelectValue,
  resolveLineSpecSelections,
} from "@/lib/webhook-admin-catalog";

export { isAdminCatalogLine, mapWebhookSelectValue } from "@/lib/webhook-admin-catalog";
import {
  parseWebhookNumericQty,
  webhookPrintQty,
  crmTicketStaffNote,
  crmLineProductionNote,
  crmCustomerFacingNote,
  crmDesignerNote,
  crmOrderIdFromPayload,
  crmCustomerIdFromPayload,
  withOrderQtyDetails,
} from "@/lib/webhook-crm-parse";
import {
  mergeWebhookDesignerNotes,
  noteHistoryFromPlainText,
  upsertCrmSeedNote,
} from "@/lib/note-history";
import {
  canonicalArtworkUrl,
  resolveWebhookItemMedia,
  skuArtworkRefs,
  type WebhookArtworkRef,
} from "@/lib/webhook-artwork";
import {
  mergeDueSpecsIntoOrderSpecs,
  recomputeDueFromProcessingDays,
  resolveWebhookDue,
  type OrderDueSpecs,
} from "@/lib/due-date";
import type { WebhookConfig } from "@/lib/types";

type Client = SupabaseClient;

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const SELECT_WEBHOOK_KEYS = new Set([
  "product",
  "product_category",
  "materials",
  "finishing",
  "lamination",
  "sides",
  "color",
  "color_mode",
  "position",
  "roll_direction",
  "special_effects",
]);

const BOOLEAN_WEBHOOK_KEYS = new Set([
  "spot_uv",
  "foil",
  "die_cut",
  "application",
  "need_a_design",
  "perforation",
]);

/** CRM / free-text sentinels that mean “no value” (not a real option). */
const NONE_SENTINELS = new Set([
  "none",
  "none (inactive)",
  "n/a",
  "na",
  "-",
  "—",
]);

interface CustomFieldDef {
  id: string;
  name: string;
  field_type: string;
  options: string[];
}

const WEBHOOK_CUSTOM_FIELD_MAP: Record<string, string> = {
  product: "Product",
  product_category: "Category",
  finished_size: "Finished Size",
  die: "Die",
  materials: "Materials",
  finishing: "Finishing",
  lamination: "Lamination",
  sides: "Sides",
  color: "Color",
  color_mode: "Color Mode",
  position: "Position",
  roll_direction: "Roll Direction",
  order_qty: "Order QTY",
  quantity: "Quantity",
  order_qty_details: "Order QTY details",
  width: "Width",
  height: "Height",
  unit_price: "Unit Price",
  special_effects: "Special effects",
  designer_information: "Designer Information",
  spot_uv: "Spot UV",
  foil: "Foil",
  die_cut: "Die Cut",
  application: "Application",
  need_a_design: "Need a Design",
  perforation: "Perforation",
};

/** DB field names that map to a webhook key (handles renames like Finishing ↔ Lamination). */
const WEBHOOK_FIELD_ALIASES: Record<string, string[]> = {
  product: ["Product"],
  product_category: ["Category"],
  finished_size: ["Finished Size"],
  die: ["Die"],
  materials: ["Materials"],
  finishing: ["Finishing", "Lamination"],
  lamination: ["Lamination", "Finishing"],
  sides: ["Sides"],
  color: ["Color"],
  color_mode: ["Color Mode", "Color"],
  position: ["Position"],
  roll_direction: ["Roll Direction", "Roll direction"],
  order_qty: ["Order QTY"],
  quantity: ["Quantity"],
  order_qty_details: ["Order QTY details", "Order QTY Details"],
  width: ["Width"],
  height: ["Height"],
  unit_price: ["Unit Price", "Unit Price ($)"],
  special_effects: ["Special effects", "Special Effects"],
  designer_information: ["Designer Information"],
  spot_uv: ["Spot UV"],
  foil: ["Foil"],
  die_cut: ["Die Cut"],
  application: ["Application"],
  need_a_design: ["Need a Design"],
  perforation: ["Perforation"],
};

interface WebhookDesignerInput {
  designer_email?: string;
  designer_id?: string;
  designer?: string;
  /** Designer Information custom field (aliases: designer_notes, notes_for_designer). */
  designer_information?: string;
  /** Alias for `designer_information`. */
  designer_notes?: string;
  /** Alias for `designer_information`. */
  notes_for_designer?: string;
  design_task?: string;
  /** CRM design capture — who provides artwork: has_files | files_coming | needs_design. */
  design_source?: string;
  /** CRM-named target board column. "" / absent = start column; a name = that column. */
  initial_column?: string;
  /** True when the customer has files but hasn't sent them (design_source files_coming). */
  needs_customer_files?: boolean;
  /** Origin channel of the order (email | call | sms | webform | ad_lead | ig_dm). */
  source_channel?: string;
  /** CRM design capture — the frozen design brief / reference. */
  design_reference?: string;
  /** Route A: files print-ready, prepress only. */
  design_ready?: boolean;
  /** Design fee (stays on the product line). */
  design_price?: string;
  /** Total SKUs to design. */
  design_sku_count?: string;
  /** CRM Files / line-item Google Drive folder (do not create a second tree). */
  item_folder_url?: string;
  /** Alias for `item_folder_url`. */
  files_url?: string;
  gdrive_folder_url?: string;
  drive_folder_url?: string;
  folder_url?: string;
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
  /** CRM catalog / product image (aliases of artwork_url). */
  image_url?: string;
  imageUrl?: string;
  thumbnail_url?: string;
  thumbnailUrl?: string;
  images?: unknown;
  artwork_files?: Array<{
    id?: number;
    name?: string;
    url?: string;
    type?: string;
  }>;
  artworkFiles?: Array<{
    id?: number;
    name?: string;
    url?: string;
    type?: string;
  }>;
  /**
   * Line Item Comment for this SKU → Notes for production on the card /
   * Job Ticket (aliases: `comment`, `line_item_comment`).
   * Do not put client-facing description here.
   */
  description?: string;
  /** Alias for line item production comment. */
  comment?: string;
  /** Alias for line item production comment. */
  line_item_comment?: string;
  /** Alias for line item production comment. */
  line_comment?: string;
}

export interface WebhookItem extends WebhookDesignerInput, WebhookOwnerInput {
  /** Stable CRM line id (ticket_line_items.id). Stored on the card so a later CRM
   *  edit re-syncs to the SAME card by id instead of by position. */
  crm_line_id?: string;
  title?: string;
  product?: string;
  /**
   * Product taxonomy category (custom field "Category").
   * Distinct from `category` / `category_name`, which map to board tags.
   * If `product_category` is omitted, `category` / `category_name` also fill
   * the Category dropdown (CRM often sends taxonomy in `category`).
   */
  product_category?: string;
  finished_size?: string;
  die?: string;
  /** Same as `die` — CRM Cutting field. */
  cutting_type?: string;
  materials?: string;
  /** Alias for `materials` (CRM often sends singular `material`). */
  material?: string;
  finishing?: string;
  sides?: string;
  color?: string;
  color_mode?: string;
  position?: string;
  roll_direction?: string;
  lamination?: string;
  width?: string | number;
  height?: string | number;
  unit_price?: string | number;
  /** Line-level quantity custom field (separate from order_qty / SKU sum). */
  quantity?: number | string;
  /**
   * Count of SKU rows on this line (1, 2, 3…). **Not** print quantity.
   * Print qty is `quantity` / `order_qty`.
   */
  sku_qty?: number | string;
  /** Size/color breakdown notes (string, not a number). */
  order_qty_details?: string;
  /** Finishing multi-select names, e.g. `["Gold Foil", "Spot UV"]`. */
  special_effects?: string[] | string;
  spot_uv?: boolean;
  foil?: boolean;
  die_cut?: boolean;
  application?: boolean;
  need_a_design?: boolean;
  perforation?: boolean;
  order_qty?: number | string;
  artwork_url?: string;
  /** Catalog / product preview when no SKU file is attached. */
  image_url?: string;
  /**
   * Portal Order Sync: extra design files. Each `url` is fetched with the
   * partner `osk_…` header (same key as status callbacks).
   */
  artwork_files?: Array<{
    id?: number;
    name?: string;
    url?: string;
    type?: string;
  }>;
  /**
   * Client-facing description (Order Description / Customer Note).
   * Visible on the card; not the same as production or designer notes.
   */
  description?: string;
  /**
   * Notes for production (Job Ticket “production notes”).
   * Aliases: `notes_for_production`, and legacy `line_item_comment` /
   * `line_comment` / `comment` when production_notes is empty.
   */
  production_notes?: string;
  /** Alias for `production_notes`. */
  notes_for_production?: string;
  /**
   * Team-only Internal notes (Attention — internal).
   * Alias: `notes`. Prefer production_notes for floor instructions.
   */
  internal_note?: string;
  /** Alias for `internal_note`. */
  notes?: string;
  /**
   * @deprecated Prefer `production_notes`. Still accepted as production notes.
   */
  line_item_comment?: string;
  /** Alias for `line_item_comment` → production notes. */
  line_comment?: string;
  /** Alias for `line_item_comment` → production notes. */
  comment?: string;
  category?: string;
  category_name?: string;
  spec_selections?: Record<string, unknown>;
  product_options?: string[];
  skus?: WebhookSkuPayload[];
  /** CRM / source order page URL — shown as Source in the card globe popover. */
  source_url?: string;
  source_link?: string;
  order_url?: string;
  /** `partial` or `full` (also accepts `paid` / `complete` → full). */
  payment_status?: string;
  payment?: string;
  deposit?: number | string;
  balance?: number | string;
  rush?: boolean | string | number;
  is_rush?: boolean | string | number;
  rush_order?: boolean | string | number;
  rush_status?: boolean | string | number;
}

export interface WebhookOrderPayload extends WebhookDesignerInput, WebhookOwnerInput {
  /**
   * Integration source key (e.g. "crm"). Matched against Settings → Integrations
   * source styles for the board label color. Unknown/missing uses the "other" style.
   */
  source?: string;
  /**
   * Item vocabulary (`admin` = Admin Item catalog). Not a board source chip —
   * `source` / `webhook_source` still decide CRM vs portal vs website.
   * Mapper key is per-line `spec_selections.bazaar_item_id`, not this tag alone.
   */
  catalog_source?: string;
  /** Flat single-item Admin specs (also accepted on `items[]`). */
  spec_selections?: Record<string, unknown>;
  /** Same as `die` — CRM Cutting field (flat payload). */
  cutting_type?: string;
  /** Display label from Bazaar (e.g. "Partner Portal") — used if `source` is omitted. */
  source_label?: string;
  /** Bazaar Order Sync "Test connection" — auth only, never create a card. */
  bazaar_connection_test?: boolean | string | number;
  /** Bazaar partner/broker id (Order Sync) — used for status callbacks. */
  bazaar_broker_id?: string;
  company_name?: string;
  company?: {
    id?: string;
    name?: string;
    slug?: string;
    kind?: string;
  };
  customer_name?: string;
  customer_contact?: string;
  customer_phone?: string;
  /** Digits-only phone for matching when `customer_phone` is formatted. */
  customer_phone_digits?: string;
  /** CRM `customers.id` (empty string if unlinked). Stored on card specs. */
  crm_customer_id?: string;
  /** CRM order id — stored on the card for idempotent re-sync. */
  crm_order_id?: string;
  /** CRM starred / key account (customers.priority_stars >= 1). */
  is_key_account?: boolean;
  /**
   * Rush / attention job. When true, the card shows the rush (attention)
   * triangle and the Rush Order tag is applied if no other tag is set.
   * Aliases: `is_rush`, `rush_order`, `rush_status`.
   */
  rush?: boolean | string | number;
  is_rush?: boolean | string | number;
  rush_order?: boolean | string | number;
  rush_status?: boolean | string | number;
  order_number?: string;
  /**
   * Human-readable title after the source label (`CRM | …`).
   * Omit or send empty to leave blank — never falls back to `order_number`.
   */
  title?: string;
  priority?: string;
  due_date?: string | null;
  /** `"fixed"` | `"after_approval"` — CRM due mode (see lib/due-date.ts). */
  due_date_mode?: string | null;
  /** Working days when mode is after_approval. */
  due_processing_days?: number | string | null;
  /** When CRM materialized the calendar due. */
  due_anchor_at?: string | null;
  /** Human label from CRM quote/PDF. */
  due_date_label?: string | null;
  /** `"set"` | `"pending_approval"` | `"none"`. */
  due_date_status?: string | null;
  category?: string;
  category_name?: string;
  product?: string;
  /**
   * Product taxonomy category (custom field "Category").
   * Distinct from `category` / `category_name`, which map to board tags.
   * If `product_category` is omitted, `category` / `category_name` also fill
   * the Category dropdown (CRM often sends taxonomy in `category`).
   */
  product_category?: string;
  finished_size?: string;
  die?: string;
  materials?: string;
  /** Alias for `materials`. */
  material?: string;
  finishing?: string;
  sides?: string;
  color?: string;
  color_mode?: string;
  position?: string;
  roll_direction?: string;
  lamination?: string;
  width?: string | number;
  height?: string | number;
  unit_price?: string | number;
  quantity?: number | string;
  special_effects?: string[] | string;
  spot_uv?: boolean;
  foil?: boolean;
  die_cut?: boolean;
  application?: boolean;
  need_a_design?: boolean;
  perforation?: boolean;
  order_qty?: number | string;
  artwork_url?: string;
  /**
   * Portal Order Sync: design files (GET with osk_). Also accepted on items[].
   */
  artwork_files?: Array<{
    id?: number;
    name?: string;
    url?: string;
    type?: string;
  }>;
  /**
   * Client-facing Order Description (Customer Note) on every card when set
   * at order level. Prefer `items[].description` per line.
   */
  description?: string;
  /**
   * Team-only Internal notes applied to every sub-card (alias: `notes`).
   * Floor instructions should use `production_notes` / `items[].production_notes`.
   */
  internal_note?: string;
  /** Alias for `internal_note`. */
  notes?: string;
  /**
   * Order-level notes for production (Job Ticket). Prefer per-item
   * `items[].production_notes`.
   */
  production_notes?: string;
  /** Alias for `production_notes`. */
  notes_for_production?: string;
  /**
   * @deprecated Prefer `production_notes`. Flat single-item production comment.
   */
  line_item_comment?: string;
  skus?: WebhookSkuPayload[];
  items?: WebhookItem[];
  /** CRM / source order page URL — stored in specs.billing and shown on the card. */
  source_url?: string;
  source_link?: string;
  order_url?: string;
  /** `partial` or `full` (also accepts `paid` / `complete` → full). */
  payment_status?: string;
  payment?: string;
  deposit?: number | string;
  balance?: number | string;
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

/** Bazaar Admin → Order Sync "Test connection" probe. Must not create a board card. */
export function isBazaarConnectionTestPayload(
  body: WebhookOrderPayload | Record<string, unknown> | null | undefined
): boolean {
  if (!body || typeof body !== "object") return false;
  const flag = (body as { bazaar_connection_test?: unknown }).bazaar_connection_test;
  if (flag === true || flag === 1) return true;
  if (typeof flag === "string" && flag.trim().toLowerCase() === "true") return true;
  return false;
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

function skuLineComment(item: WebhookSkuPayload): string | null {
  for (const key of [
    "line_item_comment",
    "line_comment",
    "comment",
  ] as const) {
    const raw = item[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

/** Staff / line comments that belong in Attention (orders.internal_note). */
function pickTrimmedNote(
  ...vals: (string | null | undefined)[]
): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Order-level notes used as staff Internal notes on every card.
 * CRM ticket Attention / Internal Notes → top-level `notes`.
 * Production floor text should use `production_notes`, not `notes`.
 */
export function resolveSharedAttentionNote(
  order: WebhookOrderPayload
): string | null {
  return crmTicketStaffNote(order);
}

/**
 * Notes for production (Job Ticket production-notes box).
 * Prefers explicit production fields; falls back to `line_item_comment`.
 * Does not use item `notes` / `description` (CRM sends those empty; ticket
 * staff notes are order-level `notes`).
 */
export function resolveItemProductionNotes(
  rawItem: WebhookItem
): string | null {
  return crmLineProductionNote(rawItem);
}

/**
 * @deprecated Internal notes are not set by webhook (staff add them in the app).
 * Kept for aggregate-detection helpers only.
 */
export function resolveItemStaffInternalNote(
  _rawItem: WebhookItem,
  _sharedNote: string | null = null
): string | null {
  return null;
}

/**
 * CRM Line Item Comment (+ optional item-only notes) for one sub-order.
 * @deprecated Prefer resolveItemProductionNotes + resolveItemStaffInternalNote.
 */
export function resolveItemLineAttentionNote(
  rawItem: WebhookItem,
  sharedNote: string | null = null
): string | null {
  const parts: string[] = [];
  const staff = resolveItemStaffInternalNote(rawItem, sharedNote);
  if (staff) parts.push(staff);
  const production = resolveItemProductionNotes(rawItem);
  if (
    production &&
    production !== staff &&
    production !== sharedNote
  ) {
    parts.push(production);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Per-item notes CRM often places on the first SKU (`skus[0].comment`) instead
 * of `line_item_comment`. Used to detect order-level note aggregation.
 */
export function resolveItemSkuAttentionNote(
  rawItem: WebhookItem
): string | null {
  if (!Array.isArray(rawItem.skus) || rawItem.skus.length === 0) return null;
  const parts: string[] = [];
  for (const sku of rawItem.skus) {
    if (!sku || typeof sku !== "object") continue;
    const comment = skuLineComment(sku);
    if (comment) parts.push(comment);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Line-item or SKU-level note that belongs on this sub-order only. */
export function resolveItemOwnAttentionNote(
  rawItem: WebhookItem,
  sharedNote: string | null = null
): string | null {
  return (
    resolveItemProductionNotes(rawItem) ??
    resolveItemStaffInternalNote(rawItem, sharedNote) ??
    resolveItemSkuAttentionNote(rawItem)
  );
}

/** Combine shared Attention + per-item line comment for one card. */
export function combineCardAttentionNotes(
  sharedNote: string | null,
  itemLineNote: string | null
): string | null {
  const a = sharedNote?.trim() || "";
  const b = itemLineNote?.trim() || "";
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const an = normalizeNoteCompare(a);
  const bn = normalizeNoteCompare(b);
  if (an === bn) return a;
  // CRM pasted the same block into both fields (one may be a longer paste).
  if (an.includes(bn)) return a;
  if (bn.includes(an)) return b;
  return `${a}\n\n${b}`;
}

function normalizeNoteCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Drop consecutive duplicate paragraphs (CRM often posts the same block twice). */
export function collapseDuplicateNoteParagraphs(text: string): string {
  const chunks = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (chunks.length <= 1) {
    // Also collapse single-newline duplicates of the same block.
    const lines = text
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 2 && normalizeNoteCompare(lines[0]!) === normalizeNoteCompare(lines[1]!)) {
      return lines[0]!;
    }
    return text.trim();
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const key = normalizeNoteCompare(chunk);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out.join("\n\n");
}

/**
 * Split CRM-aggregated line comments (often joined with ` | ` or blank lines)
 * into one segment per sub-order. Returns null when it doesn't match item count.
 */
export function splitAggregatedLineNotes(
  text: string | null | undefined,
  itemCount: number
): string[] | null {
  if (itemCount < 2) return null;
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return null;

  const trySplit = (parts: string[]): string[] | null => {
    const clean = parts.map((p) => p.trim()).filter(Boolean);
    return clean.length === itemCount ? clean : null;
  };

  return (
    trySplit(trimmed.split(/\s*\|\s*/)) ??
    trySplit(trimmed.split(/\n\s*\n+/)) ??
    trySplit(trimmed.split(/\n/))
  );
}

/**
 * Order-level Attention for multi-item creates.
 * If CRM stuffed every line comment into top-level `notes`, skip that shared
 * blob so each card only keeps its own line-item / SKU note.
 */
export function resolveSharedAttentionForItems(
  body: WebhookOrderPayload,
  items: WebhookItem[]
): string | null {
  const shared = resolveSharedAttentionNote(body);
  if (!shared || items.length < 2) return shared;

  const perItem = items
    .map((it) => resolveItemOwnAttentionNote(it, null))
    .filter((n): n is string => Boolean(n));

  const sn = normalizeNoteCompare(shared);

  if (perItem.length >= 2) {
    const candidates = [
      perItem.join("\n\n"),
      perItem.join("\n"),
      perItem.join(" | "),
      perItem.join("|"),
    ].map(normalizeNoteCompare);

    if (candidates.includes(sn)) return null;

    // Shared embeds most per-item notes (CRM paste of every line ticket).
    const embedCount = perItem.filter((p) => {
      const head = normalizeNoteCompare(p).slice(0, 64);
      return head.length >= 24 && sn.includes(head);
    }).length;
    if (embedCount >= Math.ceil(perItem.length * 0.5)) return null;
  }

  // Item titles appear inside order-level notes (typical CRM aggregate paste).
  const titles = items
    .map((it) => (typeof it.title === "string" ? it.title.trim() : ""))
    .filter((t) => t.length >= 8);
  if (titles.length >= 2) {
    const titleHits = titles.filter((t) => shared.includes(t)).length;
    if (
      titleHits >= 2 &&
      titleHits >= Math.ceil(titles.length * 0.5) &&
      perItem.length >= 1
    ) {
      return null;
    }
  }

  // Repeated "Purchased for Job#" blocks = one paste per line item.
  const purchasedHits = (shared.match(/Purchased for Job#/gi) ?? []).length;
  if (purchasedHits >= 2 && perItem.length >= 1) return null;

  return shared;
}

/**
 * Per-card team-only Internal notes (Attention — internal).
 * Production floor text is resolved separately via {@link resolveCardProductionNotes}.
 */
export function resolveCardAttentionNotes(opts: {
  items: WebhookItem[];
  itemIndex: number;
  sharedAttention: string | null;
  splitFromNotes: string[] | null;
  splitFromDesignTask: string[] | null;
}): { attention: string | null; suppressMisroutedDesignTask: boolean } {
  const {
    items,
    itemIndex,
    sharedAttention,
    splitFromNotes,
    splitFromDesignTask,
  } = opts;
  const rawItem = items[itemIndex]!;
  const ownNote = resolveItemOwnAttentionNote(rawItem, sharedAttention);
  let itemStaff = resolveItemStaffInternalNote(rawItem, sharedAttention);

  // Fall back to split aggregates only when this item has no own notes at all.
  if (!ownNote && !itemStaff && splitFromNotes?.[itemIndex]) {
    itemStaff = splitFromNotes[itemIndex]!;
  }
  if (!ownNote && !itemStaff && splitFromDesignTask?.[itemIndex]) {
    itemStaff = splitFromDesignTask[itemIndex]!;
  }

  let shared = splitFromNotes ? null : sharedAttention;

  // Extra guard: CRM often pastes every line's note into order-level `notes`
  // AND still sends each line's text on skus[0].comment.
  if (shared && items.length > 1) {
    const sn = normalizeNoteCompare(shared);
    const foreignHit = items.some((it, idx) => {
      if (idx === itemIndex) return false;
      const other = resolveItemOwnAttentionNote(it, null);
      if (!other) return false;
      const head = normalizeNoteCompare(other).slice(0, 48);
      return head.length >= 20 && sn.includes(head);
    });
    if (foreignHit) shared = null;
  }

  return {
    attention: combineCardAttentionNotes(shared, itemStaff),
    suppressMisroutedDesignTask: Boolean(splitFromDesignTask),
  };
}

/**
 * Per-card Notes for production (Job Ticket production-notes box).
 * Includes unique SKU comments that are not already in the production text.
 */
export function resolveCardProductionNotes(opts: {
  item: WebhookItem;
  skuComments: { index: number; name: string; comment: string }[];
  orderProductionNotes?: string | null;
}): string | null {
  const itemProd = resolveItemProductionNotes(opts.item);
  const orderProd =
    typeof opts.orderProductionNotes === "string"
      ? opts.orderProductionNotes.trim()
      : "";
  const base = withOrderQtyDetails(
    itemProd || orderProd || null,
    opts.item.order_qty_details
  );
  return buildWebhookNotes({
    internalNote: base,
    skuComments: opts.skuComments,
  });
}

function normalizeWebhookSkus(
  raw: WebhookSkuPayload[] | undefined
): {
  skus: SkuItem[];
  artworkBySkuId: Map<string, WebhookArtworkRef[]>;
  skuComments: { index: number; name: string; comment: string }[];
} {
  const artworkBySkuId = new Map<string, WebhookArtworkRef[]>();
  const skuComments: { index: number; name: string; comment: string }[] = [];
  if (!Array.isArray(raw)) {
    return { skus: [], artworkBySkuId, skuComments };
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
    const comment = skuLineComment(item);
    const hasSku = name || (qty != null && !Number.isNaN(qty));
    if (hasSku) {
      skus.push({
        id,
        name,
        qty:
          qty != null && !Number.isNaN(qty) && qty >= 1
            ? Math.floor(qty)
            : null,
      });
      if (comment) {
        skuComments.push({
          index: skus.length,
          name,
          comment,
        });
      }
    } else if (comment) {
      // Comment-only row still counts toward labeled description lines.
      skuComments.push({
        index: skuComments.length + 1,
        name: "",
        comment,
      });
    }
    const refs = skuArtworkRefs(item);
    if (hasSku && refs.length > 0) {
      artworkBySkuId.set(id, refs);
    }
  }

  return { skus, artworkBySkuId, skuComments };
}

/** Design files field — only accept http(s) folder/file links. */
function resolveDesignTaskUrl(input: WebhookDesignerInput): string | null {
  const raw =
    typeof input.design_task === "string" ? input.design_task.trim() : "";
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Free-text designer notes for the Designer Information custom field.
 * Non-URL `design_task` values are treated as misrouted line comments (see
 * buildWebhookOrderDescription), not Design files.
 */
function resolveDesignNotes(input: WebhookDesignerInput): string | null {
  return crmDesignerNote(input);
}

/** Non-URL design_task text — CRM often sent line comments here by mistake. */
function resolveMisroutedDesignTaskText(
  input: WebhookDesignerInput
): string | null {
  const raw =
    typeof input.design_task === "string" ? input.design_task.trim() : "";
  if (!raw) return null;
  if (resolveDesignTaskUrl(input)) return null;
  return raw;
}

/**
 * Build Order Description: optional order/item notes only.
 * Per-SKU line comments go to Attention via {@link buildWebhookNotes}.
 */
export function buildWebhookOrderDescription(opts: {
  orderDescription?: string | null;
  itemDescription?: string | null;
  /** @deprecated SKU comments now go to Attention — ignored when present. */
  skuComments?: { index: number; name: string; comment: string }[];
  /** Non-URL text wrongly sent as design_task. */
  misroutedDesignTask?: string | null;
}): string | null {
  const parts: string[] = [];
  const orderDesc = opts.orderDescription?.trim() || "";
  const itemDesc = opts.itemDescription?.trim() || "";
  if (orderDesc) parts.push(orderDesc);
  if (itemDesc && itemDesc !== orderDesc) parts.push(itemDesc);

  const misrouted = opts.misroutedDesignTask?.trim() || "";
  if (misrouted) {
    const already = orderDesc === misrouted || itemDesc === misrouted;
    if (!already) parts.push(misrouted);
  }

  const combined = parts.join("\n\n").trim();
  return combined || null;
}

/**
 * Build Attention / Internal notes text: staff notes + SKU line comments
 * (plain comment text — no `SKU1:` prefix).
 *
 * CRM often pastes the same text into both `line_item_comment` and
 * `skus[0].comment` — skip SKU comments already present in the staff note.
 *
 * ```
 * Rush — confirm ship date
 *
 * 1 sku- 200 boxes- (matte finish)
 * 2 sided lb bag- (sample)
 * ```
 */
export function buildWebhookNotes(opts: {
  internalNote?: string | null;
  skuComments?: { index: number; name: string; comment: string }[];
}): string | null {
  const parts: string[] = [];
  const note = collapseDuplicateNoteParagraphs(opts.internalNote?.trim() || "");
  if (note) parts.push(note);

  const noteNorm = note ? normalizeNoteCompare(note) : "";
  const seen = new Set<string>();
  const skuLines: string[] = [];
  for (const s of opts.skuComments ?? []) {
    const comment = collapseDuplicateNoteParagraphs(s.comment.trim());
    if (!comment) continue;
    const c = normalizeNoteCompare(comment);
    if (!c || seen.has(c)) continue;
    // Already in the line/staff note (exact, contained, or contains) → don't paste twice.
    if (
      noteNorm &&
      (noteNorm === c || noteNorm.includes(c) || c.includes(noteNorm))
    ) {
      continue;
    }
    seen.add(c);
    skuLines.push(comment);
  }
  if (skuLines.length > 0) {
    parts.push(skuLines.join("\n"));
  }

  const combined = collapseDuplicateNoteParagraphs(parts.join("\n\n").trim());
  return combined || null;
}

function formatSpecialEffects(
  raw: string[] | string | null | undefined
): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const parts = raw
      .map((v) => (typeof v === "string" ? v.trim() : String(v).trim()))
      .filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function formatDimension(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function buildFinishedSizeFromDimensions(
  width: string | number | null | undefined,
  height: string | number | null | undefined,
  existing?: string | null
): string | null {
  const existingTrim = typeof existing === "string" ? existing.trim() : "";
  if (existingTrim) return existingTrim;
  const w = formatDimension(width);
  const h = formatDimension(height);
  if (w && h) return `${w} x ${h}`;
  return w || h || null;
}

interface WebhookCustomerInfo {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  /** Stored on the order Customer Contact field — phone preferred when both are sent. */
  orderContact: string;
}

export function parseWebhookCustomerInfo(body: WebhookOrderPayload): WebhookCustomerInfo {
  const customerName =
    typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const contactRaw =
    typeof body.customer_contact === "string" ? body.customer_contact.trim() : "";
  const phoneRaw =
    typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
  const digitsRaw =
    typeof body.customer_phone_digits === "string"
      ? body.customer_phone_digits.trim()
      : "";

  const customerEmail =
    parseContactEmail(contactRaw) ?? parseContactEmail(phoneRaw);
  const customerPhone =
    parseContactPhone(phoneRaw) ??
    parseContactPhone(digitsRaw) ??
    parseContactPhone(contactRaw);

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

/** CRM reference codes look like ORD-2026-0298 (optional item suffix allowed on card titles only). */
const CRM_ORDER_NUMBER_RE = /^ORD-\d{4}-\S+$/i;

/**
 * When the payload is CRM (explicit source or ORD-… number), require a valid
 * order_number. Never accept product descriptions as the order reference.
 */
function assertCrmOrderNumber(
  orderNumber: string,
  sourceKey: string
): void {
  const looksLikeCrm =
    sourceKey === "crm" || CRM_ORDER_NUMBER_RE.test(orderNumber);
  if (!looksLikeCrm) return;
  if (!CRM_ORDER_NUMBER_RE.test(orderNumber)) {
    console.error(
      "[webhook/orders] rejected: CRM order_number must match ORD-YYYY-####",
      { orderNumber, source: sourceKey || "(empty)" }
    );
    throw new WebhookValidationError(
      "CRM orders require order_number matching ORD-YYYY-#### (e.g. ORD-2026-0298)"
    );
  }
}

function shortOrderCardBase(orderNumber: string): string {
  const trimmed = orderNumber.trim();
  const match = /^ord-\d{4}-(.+)$/i.exec(trimmed);
  if (!match) return trimmed;
  const short = match[1]?.trim();
  return short ? short : trimmed;
}

function resolveDueDate(body: WebhookOrderPayload): {
  dueDate: string | null;
  dueSpecs: OrderDueSpecs;
} {
  const resolved = resolveWebhookDue({
    due_date: body.due_date,
    due_date_mode: body.due_date_mode,
    due_processing_days: body.due_processing_days,
    due_anchor_at: body.due_anchor_at,
    due_date_label: body.due_date_label,
    due_date_status: body.due_date_status,
  });
  if (resolved.dueDate) {
    const dueDateError = validateDueDate(resolved.dueDate);
    if (dueDateError) {
      throw new WebhookValidationError(dueDateError);
    }
  }
  return { dueDate: resolved.dueDate, dueSpecs: resolved.specs };
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
      product_category: body.product_category,
      finished_size: body.finished_size,
      die: body.die,
      cutting_type: body.cutting_type,
      spec_selections: resolveLineSpecSelections(null, body) ?? undefined,
      materials: firstNonEmpty(body.materials, body.material),
      finishing: body.finishing,
      sides: body.sides,
      color: body.color ?? body.color_mode,
      color_mode: body.color_mode,
      position: body.position,
      roll_direction: body.roll_direction,
      lamination: body.lamination,
      width: body.width,
      height: body.height,
      unit_price: body.unit_price,
      quantity: body.quantity,
      special_effects: body.special_effects,
      spot_uv: body.spot_uv,
      foil: body.foil,
      die_cut: body.die_cut,
      application: body.application,
      need_a_design: body.need_a_design,
      perforation: body.perforation,
      order_qty: body.order_qty,
      artwork_url: body.artwork_url,
      artwork_files: body.artwork_files,
      description: body.description,
      internal_note: body.internal_note ?? body.notes,
      notes: body.notes,
      production_notes: body.production_notes ?? body.notes_for_production,
      notes_for_production: body.notes_for_production,
      line_item_comment: body.line_item_comment,
      skus: body.skus,
      designer_email: body.designer_email,
      designer_id: body.designer_id,
      designer: body.designer,
      designer_information: body.designer_information,
      designer_notes: body.designer_notes,
      notes_for_designer: body.notes_for_designer,
      design_task: body.design_task,
      item_folder_url: body.item_folder_url,
      files_url: body.files_url,
      gdrive_folder_url: body.gdrive_folder_url,
      drive_folder_url: body.drive_folder_url,
      folder_url: body.folder_url,
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
  if (!orderTitle.trim()) return productLabel;
  return `${orderTitle} — ${productLabel}`;
}

/**
 * Human-readable label after the source (`CRM | …`), stored as
 * `specs.webhook_order_title`. Prefer payload `title`; never fall back to
 * `order_number` (omit/empty → blank on the board).
 */
function resolveOrderLevelTitle(
  body: WebhookOrderPayload,
  orderNumber: string
): string {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title && !isOrderNumberLikeTitle(title, orderNumber)) {
    return title;
  }
  return "";
}

/** True when a "title" is really just the order number (or a short form of it). */
export function isOrderNumberLikeTitle(
  title: string,
  orderNumber: string
): boolean {
  const t = title.trim();
  if (!t) return true;
  const ord = orderNumber.trim();
  if (ord && t.toLowerCase() === ord.toLowerCase()) return true;

  const shortOrd = shortOrderCardBase(ord);
  if (shortOrd && t.toLowerCase() === shortOrd.toLowerCase()) return true;

  // Bare ORD-YYYY-NNNN (or same with optional suffix) with no other words
  if (/^ord-\d{4}-\S+$/i.test(t)) return true;

  return false;
}

type WebhookSpecFields = {
  product?: string;
  product_category?: string;
  finished_size?: string;
  die?: string;
  materials?: string;
  finishing?: string;
  lamination?: string;
  sides?: string;
  color?: string;
  color_mode?: string;
  position?: string;
  roll_direction?: string;
  order_qty?: number | string;
  quantity?: number | string;
  order_qty_details?: string;
  sku_qty?: number | string;
  width?: string;
  height?: string;
  unit_price?: number | string;
  special_effects?: string;
  designer_information?: string;
  spot_uv?: boolean;
  foil?: boolean;
  die_cut?: boolean;
  application?: boolean;
  need_a_design?: boolean;
  perforation?: boolean;
};

/** Prefer non-empty trimmed strings (AI templates often send `""`). */
function firstNonEmpty(
  ...vals: (string | null | undefined)[]
): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function mergeItemWithOrder(
  order: WebhookOrderPayload,
  item: WebhookItem
): WebhookItem {
  return {
    ...item,
    spec_selections: resolveLineSpecSelections(item, order) ?? undefined,
    product: firstNonEmpty(item.product, order.product),
    // CRM often sends product taxonomy as `category` (also used for board tags).
    // Prefer explicit product_category; fall back so Category dropdown is filled.
    product_category: firstNonEmpty(
      item.product_category,
      order.product_category,
      item.category,
      order.category,
      item.category_name,
      order.category_name
    ),
    finished_size: firstNonEmpty(item.finished_size, order.finished_size),
    die: firstNonEmpty(item.die, item.cutting_type, order.die),
    materials: firstNonEmpty(
      item.materials,
      item.material,
      order.materials,
      order.material
    ),
    finishing: firstNonEmpty(
      item.finishing,
      item.lamination,
      order.finishing,
      order.lamination
    ),
    lamination: firstNonEmpty(
      item.lamination,
      item.finishing,
      order.lamination,
      order.finishing
    ),
    sides: firstNonEmpty(item.sides, order.sides),
    color: firstNonEmpty(item.color, order.color),
    color_mode: firstNonEmpty(
      item.color_mode,
      item.color,
      order.color_mode,
      order.color
    ),
    position: firstNonEmpty(item.position, order.position),
    roll_direction: firstNonEmpty(item.roll_direction, order.roll_direction),
    width: item.width ?? order.width,
    height: item.height ?? order.height,
    unit_price: item.unit_price ?? order.unit_price,
    quantity: item.quantity ?? order.quantity,
    sku_qty: item.sku_qty,
    order_qty_details: firstNonEmpty(item.order_qty_details),
    special_effects: item.special_effects ?? order.special_effects,
    spot_uv: item.spot_uv ?? order.spot_uv,
    foil: item.foil ?? order.foil,
    die_cut: item.die_cut ?? order.die_cut,
    application: item.application ?? order.application,
    need_a_design: item.need_a_design ?? order.need_a_design,
    perforation: item.perforation ?? order.perforation,
    order_qty: item.order_qty ?? order.order_qty,
    artwork_url: firstNonEmpty(item.artwork_url, order.artwork_url),
    artwork_files:
      Array.isArray(item.artwork_files) && item.artwork_files.length > 0
        ? item.artwork_files
        : order.artwork_files,
    description: firstNonEmpty(item.description, order.description),
    // Item notes/description are empty from CRM. Order-level `notes` is staff
    // Internal notes on every card — do not copy onto the line as production text.
    internal_note: firstNonEmpty(item.internal_note),
    notes: firstNonEmpty(item.notes),
    production_notes: firstNonEmpty(
      item.production_notes,
      item.notes_for_production,
      order.production_notes,
      order.notes_for_production
    ),
    notes_for_production: firstNonEmpty(
      item.notes_for_production,
      order.notes_for_production
    ),
    line_item_comment: item.line_item_comment,
    line_comment: item.line_comment,
    comment: item.comment,
    category: firstNonEmpty(item.category, order.category),
    category_name: firstNonEmpty(item.category_name, order.category_name),
    rush: item.rush ?? order.rush,
    is_rush: item.is_rush ?? order.is_rush,
    rush_order: item.rush_order ?? order.rush_order,
    rush_status: item.rush_status ?? order.rush_status,
    designer_email: firstNonEmpty(item.designer_email, order.designer_email),
    designer_id: firstNonEmpty(item.designer_id, order.designer_id),
    designer: firstNonEmpty(item.designer, order.designer),
    designer_information: firstNonEmpty(
      item.designer_information,
      order.designer_information
    ),
    designer_notes: firstNonEmpty(item.designer_notes, order.designer_notes),
    notes_for_designer: firstNonEmpty(
      item.notes_for_designer,
      order.notes_for_designer
    ),
    design_task: firstNonEmpty(item.design_task),
    item_folder_url: firstNonEmpty(item.item_folder_url),
    files_url: firstNonEmpty(item.files_url, item.item_folder_url),
    gdrive_folder_url: firstNonEmpty(
      item.gdrive_folder_url,
      order.gdrive_folder_url
    ),
    drive_folder_url: firstNonEmpty(
      item.drive_folder_url,
      order.drive_folder_url
    ),
    folder_url: firstNonEmpty(item.folder_url, order.folder_url),
    owner_email: firstNonEmpty(item.owner_email, order.owner_email),
    owner_id: firstNonEmpty(item.owner_id, order.owner_id),
    owner_name: firstNonEmpty(item.owner_name, order.owner_name),
    owner: firstNonEmpty(item.owner, order.owner),
    request_owner_email: firstNonEmpty(
      item.request_owner_email,
      order.request_owner_email
    ),
    request_owner_id: firstNonEmpty(
      item.request_owner_id,
      order.request_owner_id
    ),
    request_owner: firstNonEmpty(item.request_owner, order.request_owner),
    request_owner_name: firstNonEmpty(
      item.request_owner_name,
      order.request_owner_name
    ),
    request_owner_contact: firstNonEmpty(
      item.request_owner_contact,
      order.request_owner_contact
    ),
    request_owner_phone: firstNonEmpty(
      item.request_owner_phone,
      order.request_owner_phone
    ),
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
    design_task: firstNonEmpty(item.design_task),
    item_folder_url: firstNonEmpty(item.item_folder_url),
    files_url: firstNonEmpty(item.files_url, item.item_folder_url),
    gdrive_folder_url: item.gdrive_folder_url ?? order.gdrive_folder_url,
    drive_folder_url: item.drive_folder_url ?? order.drive_folder_url,
    folder_url: item.folder_url ?? order.folder_url,
  };
}

function normalizeSpecFields(item: WebhookItem): WebhookSpecFields {
  const width = formatDimension(item.width);
  const height = formatDimension(item.height);
  const die = firstNonEmpty(item.die, item.cutting_type);
  return {
    product: item.product,
    product_category: item.product_category,
    finished_size:
      buildFinishedSizeFromDimensions(width, height, item.finished_size) ??
      undefined,
    die,
    materials: firstNonEmpty(item.materials, item.material),
    finishing: item.finishing ?? item.lamination,
    lamination: item.lamination ?? item.finishing,
    sides: item.sides,
    color: item.color,
    color_mode: item.color_mode ?? item.color,
    position: item.position,
    roll_direction: item.roll_direction,
    order_qty: item.order_qty ?? item.quantity,
    quantity: item.quantity ?? item.order_qty,
    order_qty_details: firstNonEmpty(item.order_qty_details),
    sku_qty: item.sku_qty,
    width: width ?? undefined,
    height: height ?? undefined,
    unit_price: item.unit_price,
    special_effects: formatSpecialEffects(item.special_effects) ?? undefined,
    designer_information: resolveDesignNotes(item) ?? undefined,
    spot_uv: item.spot_uv,
    foil: item.foil,
    die_cut: item.die_cut,
    application: item.application,
    need_a_design: item.need_a_design,
    perforation: item.perforation,
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


/** Resolve a webhook value against tenant select options (legacy alias/fuzzy). */
function resolveSelectField(
  value: string,
  options: string[],
  fieldName: string,
  corrections: string[],
  keepUnmatched = false
): string | null {
  return mapWebhookSelectValue({
    field: fieldName,
    value,
    options,
    adminIdentity: false,
    corrections,
    keepUnmatched,
  });
}

/** Resolve comma-/array-style multi values against select options. */
function resolveMultiSelectField(
  raw: unknown,
  options: string[],
  fieldName: string,
  corrections: string[],
  keepUnmatched = false
): string | null {
  const parts: string[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
      if (s) parts.push(s);
    }
  } else if (typeof raw === "string") {
    for (const part of raw.split(/[,;|]/)) {
      const s = part.trim();
      if (s) parts.push(s);
    }
  } else {
    return null;
  }
  if (parts.length === 0) return null;

  const matched: string[] = [];
  for (const part of parts) {
    const resolved = resolveSelectField(part, options, fieldName, corrections, keepUnmatched);
    if (resolved) matched.push(resolved);
  }
  return matched.length > 0 ? matched.join(", ") : null;
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
  corrections: string[],
  adminIdentity = false
): unknown {
  if (BOOLEAN_WEBHOOK_KEYS.has(webhookKey)) {
    return typeof raw === "boolean" ? raw : null;
  }

  if (raw === null || raw === undefined || raw === "") return null;

  if (webhookKey === "sku_qty") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  if (webhookKey === "order_qty" || webhookKey === "quantity") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isNaN(n) ? null : n;
  }

  if (webhookKey === "unit_price" || webhookKey === "width" || webhookKey === "height") {
    if (webhookKey === "unit_price") {
      const n =
        typeof raw === "number"
          ? raw
          : Number(String(raw).trim().replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const dim = String(raw).trim();
    if (!dim || NONE_SENTINELS.has(dim.toLowerCase())) return null;
    const n = Number(dim);
    return Number.isFinite(n) ? n : dim;
  }

  if (webhookKey === "special_effects") {
    const options =
      field?.field_type === "select"
        ? selectOptionsForWebhookField(webhookKey, field.options)
        : [];
    if (options.length > 0) {
      // keepUnmatched=true: store unrecognized special-effect values as-is
      // to prevent data loss (e.g. "Scodix Raised UV — 50 Microns")
      return resolveMultiSelectField(raw, options, webhookKey, corrections, true);
    }
    return formatSpecialEffects(
      raw as string[] | string | null | undefined
    );
  }

  const text = String(raw).trim();
  if (!text) return null;
  if (
    NONE_SENTINELS.has(text.toLowerCase()) &&
    !(
      field?.field_type === "select" &&
      field.options.some((o) => o.trim().toLowerCase() === "none")
    )
  ) {
    return null;
  }

  if (
    field?.field_type === "select" &&
    SELECT_WEBHOOK_KEYS.has(webhookKey)
  ) {
    const options = selectOptionsForWebhookField(webhookKey, field.options);
    if (options.length > 0) {
      return mapWebhookSelectValue({
        field: webhookKey,
        value: text,
        options,
        adminIdentity,
        corrections,
        keepUnmatched:
          webhookKey === "product_category" || webhookKey === "materials",
      });
    }
  }

  if (adminIdentity && webhookKey === "finished_size") {
    return text;
  }

  return text;
}

function buildCustomFieldValues(
  fields: Map<string, CustomFieldDef>,
  specFields: WebhookSpecFields,
  customerName: string,
  orderContact: string,
  skus: SkuItem[],
  corrections: string[],
  adminIdentity = false
): { customFieldId: string; value: unknown }[] {
  const byFieldId = new Map<string, unknown>();

  const nameField = fields.get(CUSTOMER_NAME_FIELD_NAME);
  const contactField = fields.get(CUSTOMER_CONTACT_FIELD_NAME);
  if (nameField && customerName) byFieldId.set(nameField.id, customerName);
  if (contactField && orderContact) byFieldId.set(contactField.id, orderContact);

  const printQty = webhookPrintQty(specFields, skus);

  for (const [webhookKey] of Object.entries(WEBHOOK_CUSTOM_FIELD_MAP)) {
    if (webhookKey === "color" && specFields.color_mode) continue;
    if (webhookKey === "finishing" && specFields.lamination) continue;
    if (webhookKey === "sku_qty") continue;
    if (webhookKey === "order_qty" || webhookKey === "quantity") {
      continue;
    }
    const field = fields.get(webhookKey);
    if (!field) continue;
    const raw = specFields[webhookKey as keyof WebhookSpecFields];
    const value = resolveWebhookFieldValue(
      webhookKey,
      raw,
      field,
      corrections,
      adminIdentity
    );
    if (value === null) continue;
    byFieldId.set(field.id, value);
  }

  const orderQtyField = fields.get("order_qty");
  if (orderQtyField && printQty != null) {
    byFieldId.set(orderQtyField.id, printQty);
  }

  const quantityField = fields.get("quantity");
  if (quantityField && printQty != null) {
    byFieldId.set(quantityField.id, printQty);
  }

  // Infer Category from Product. CRM often sends "Other" (or a board tag) here.
  // Admin-shaped lines: do not force Folding Cartons after Product stays Admin name.
  const categoryFieldDef = fields.get("product_category");
  const productFieldDef = fields.get("product");
  const productVal = productFieldDef
    ? byFieldId.get(productFieldDef.id)
    : undefined;
  const productStr =
    (typeof productVal === "string" && productVal.trim()) ||
    (typeof specFields.product === "string" ? specFields.product.trim() : "");
  if (!adminIdentity) {
    const inferred = categoryForProduct(productStr);
    if (categoryFieldDef && inferred) {
      const current = byFieldId.get(categoryFieldDef.id);
      const currentStr = current == null ? "" : String(current).trim();
      if (!currentStr || isCatchAllCategory(currentStr)) {
        const matched =
          findMatchingOption(categoryFieldDef.options, inferred) ?? inferred;
        byFieldId.set(categoryFieldDef.id, matched);
      }
    }
  }

  // Filling Die text implies Die Cut is on.
  const dieFieldDef = fields.get("die");
  const dieCutFieldDef = fields.get("die_cut");
  if (dieFieldDef && dieCutFieldDef) {
    const dieVal = byFieldId.get(dieFieldDef.id);
    const dieFilled =
      dieVal !== null &&
      dieVal !== undefined &&
      String(dieVal).trim() !== "";
    if (dieFilled && !byFieldId.has(dieCutFieldDef.id)) {
      byFieldId.set(dieCutFieldDef.id, true);
    }
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
    /** Prefer portal `artwork_files[].name` over URL basename (often just a file id). */
    fileName?: string | null;
    /**
     * Mark this asset as a locked internal reference. Webhook (CRM) artwork is
     * always locked: designers can't delete/replace it and it is never sent to
     * the customer. Their own proof files (uploaded later) are unlocked and
     * customer-facing. Requires migration 0075_assets_is_locked.
     */
    isLocked?: boolean;
  }
): Promise<string | null> {
  // Idempotent on re-fire: same order + URL (kept after download) must not duplicate.
  const { data: existingAsset } = await client
    .from("assets")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .eq("order_id", params.orderId)
    .eq("external_url", params.externalUrl)
    .maybeSingle();
  if (existingAsset?.id) return null;

  const explicitName =
    typeof params.fileName === "string" ? params.fileName.trim() : "";
  const row = {
    tenant_id: params.tenantId,
    order_id: params.orderId,
    sku_key: params.skuKey ?? null,
    file_name: explicitName
      ? explicitName.split("/").pop() || explicitName
      : fileNameFromUrl(params.externalUrl),
    storage_path: null,
    external_url: params.externalUrl,
    mime_type: null,
    size: null,
    uploaded_by: null,
    is_locked: params.isLocked ?? false,
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

async function insertWebhookArtwork(
  client: Client,
  params: {
    tenantId: string;
    orderId: string;
    item: WebhookItem;
    artworkBySkuId: Map<string, WebhookArtworkRef[]>;
    soleSkuId: string | null;
  }
): Promise<string[]> {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const soleSkuId = params.soleSkuId?.trim() || null;

  const { data: existingArts } = await client
    .from("assets")
    .select("external_url")
    .eq("tenant_id", params.tenantId)
    .eq("order_id", params.orderId);
  for (const row of existingArts ?? []) {
    const ext =
      typeof (row as { external_url?: string | null }).external_url === "string"
        ? (row as { external_url: string }).external_url.trim()
        : "";
    if (ext) seen.add(canonicalArtworkUrl(ext));
  }

  const add = async (
    url: string,
    fileName: string | null | undefined,
    skuKey: string | null
  ) => {
    const href = url.trim();
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) return;
    const key = canonicalArtworkUrl(href);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const assetError = await insertExternalAsset(client, {
      tenantId: params.tenantId,
      orderId: params.orderId,
      externalUrl: href,
      skuKey,
      fileName: typeof fileName === "string" ? fileName : null,
      isLocked: true,
    });
    if (assetError) {
      warnings.push(`Artwork could not be saved: ${assetError}`);
    }
  };

  if (typeof params.item.artwork_url === "string" && params.item.artwork_url.trim()) {
    const primaryUrl = params.item.artwork_url.trim();
    const matchingFile = Array.isArray(params.item.artwork_files)
      ? params.item.artwork_files.find(
          (af) =>
            typeof af?.url === "string" &&
            canonicalArtworkUrl(af.url) === canonicalArtworkUrl(primaryUrl)
        )
      : undefined;
    await add(
      primaryUrl,
      typeof matchingFile?.name === "string" ? matchingFile.name : null,
      soleSkuId
    );
  }

  const catalogImage =
    typeof params.item.image_url === "string" ? params.item.image_url.trim() : "";
  if (catalogImage) {
    await add(catalogImage, "product-preview", soleSkuId);
  }

  for (const af of Array.isArray(params.item.artwork_files)
    ? params.item.artwork_files
    : []) {
    const url = typeof af?.url === "string" ? af.url.trim() : "";
    if (!url) continue;
    await add(url, typeof af?.name === "string" ? af.name : null, soleSkuId);
  }

  for (const [skuId, refs] of params.artworkBySkuId) {
    for (const ref of refs) {
      await add(ref.url, ref.fileName, skuId);
    }
  }

  return warnings;
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

async function resolveTagId(
  client: Client,
  tenantId: string,
  name: string | undefined | null
): Promise<string | null> {
  if (typeof name !== "string" || !name.trim()) return null;
  const { data: tag } = await client
    .from("tags")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", name.trim())
    .maybeSingle();
  return (tag as { id: string } | null)?.id ?? null;
}

async function listTenantTags(
  client: Client,
  tenantId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data } = await client
    .from("tags")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });
  return ((data ?? []) as { id: string; name: string }[]).filter(
    (t) => t.id && t.name?.trim()
  );
}

function tagIdFromItemExactWord(
  item: WebhookItem,
  jobTitle: string | null | undefined,
  tags: Array<{ id: string; name: string }>
): string | null {
  return firstMatchingTagId(webhookItemTagHaystack(item, jobTitle), tags);
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

async function findExistingWebhookOrders(
  client: Client,
  tenantId: string,
  webhookOrderNumber: string,
  shortBase: string,
  itemCount: number,
  crmOrderId?: string | null
): Promise<{ id: string; title: string; specs: Record<string, unknown> }[]> {
  const titles =
    itemCount > 1
      ? Array.from({ length: itemCount }, (_, i) => `${shortBase}-${i + 1}`)
      : [shortBase];

  const lookups = [
    client
      .from("orders")
      .select("id, title, specs")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .filter("specs->>webhook_order_number", "eq", webhookOrderNumber),
    client
      .from("orders")
      .select("id, title, specs")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .in("title", titles),
  ];
  const trimmedCrmId = crmOrderId?.trim() ?? "";
  if (trimmedCrmId) {
    lookups.push(
      client
        .from("orders")
        .select("id, title, specs")
        .eq("tenant_id", tenantId)
        .is("removed_at", null)
        .eq("crm_order_id", trimmedCrmId),
      client
        .from("orders")
        .select("id, title, specs")
        .eq("tenant_id", tenantId)
        .is("removed_at", null)
        .filter("specs->>crm_order_id", "eq", trimmedCrmId)
    );
  }

  const results = await Promise.all(lookups);

  const byId = new Map<
    string,
    { id: string; title: string; specs: Record<string, unknown> }
  >();
  for (const res of results) {
    for (const row of res.data ?? []) {
      const id = row.id as string;
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        title: (row.title as string) ?? "",
        specs: ((row.specs as Record<string, unknown> | null) ?? {}) as Record<
          string,
          unknown
        >,
      });
    }
  }
  return [...byId.values()];
}

/**
 * CRM / portal re-fire: copy designer_notes onto the ticket Designer note
 * field (`specs.designer_notes`). Previously they only filled the hidden
 * "Designer Information" custom field, so cards like 702 never showed them.
 *
 * Also maps Customer note, Production notes (CRM seed only), and CRM ids.
 * Empty incoming fields do not clear staff-authored notes.
 */
async function refreshExistingOrderDesignerNotes(
  client: Client,
  tenantId: string,
  existing: { id: string; title: string; specs: Record<string, unknown> }[],
  body: WebhookOrderPayload,
  items: WebhookItem[]
): Promise<void> {
  const sorted = [...existing].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true })
  );
  const crmOrderId = crmOrderIdFromPayload(body);
  const crmCustomerId = crmCustomerIdFromPayload(body);
  const orderProductionNotes = pickTrimmedNote(
    body.production_notes,
    body.notes_for_production,
    body.line_item_comment
  );
  const orderCustomerNote = crmCustomerFacingNote(body);

  for (let i = 0; i < sorted.length && i < items.length; i++) {
    const order = sorted[i]!;
    const merged = mergeItemWithOrder(body, items[i]!);
    const designNotes = crmDesignerNote(merged) ?? resolveDesignNotes(merged);
    const customerNote = crmCustomerFacingNote(body, merged) ?? orderCustomerNote;
    const { skuComments } = normalizeWebhookSkus(merged.skus);
    const productionPlain = resolveCardProductionNotes({
      item: merged,
      skuComments,
      orderProductionNotes,
    });

    const { data: freshRow } = await client
      .from("orders")
      .select("id, description, crm_order_id, specs")
      .eq("id", order.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const specs =
      freshRow?.specs && typeof freshRow.specs === "object"
        ? (freshRow.specs as Record<string, unknown>)
        : (order.specs ?? {});

    const nextSpecs: Record<string, unknown> = { ...specs };
    let specsChanged = false;

    if (designNotes) {
      const existingRaw =
        typeof specs.designer_notes === "string" ? specs.designer_notes : null;
      const next = mergeWebhookDesignerNotes(existingRaw, designNotes);
      if (next && next !== existingRaw) {
        nextSpecs.designer_notes = next;
        specsChanged = true;
      }
    }

    if (customerNote) {
      const existingCustomer =
        typeof specs.customer_facing_note === "string"
          ? specs.customer_facing_note.trim()
          : "";
      if (existingCustomer !== customerNote) {
        nextSpecs.customer_facing_note = customerNote;
        specsChanged = true;
      }
    }

    if (productionPlain) {
      const existingProd =
        typeof specs.production_notes === "string"
          ? specs.production_notes
          : null;
      const nextProd = upsertCrmSeedNote(existingProd, productionPlain);
      if (nextProd && nextProd !== existingProd) {
        nextSpecs.production_notes = nextProd;
        specsChanged = true;
      }
    }

    if (crmOrderId && specs.crm_order_id !== crmOrderId) {
      nextSpecs.crm_order_id = crmOrderId;
      specsChanged = true;
    }
    if (crmCustomerId && specs.crm_customer_id !== crmCustomerId) {
      nextSpecs.crm_customer_id = crmCustomerId;
      specsChanged = true;
    }

    const sourceChannelClean = normalizeSourceChannel(body.source_channel);
    if (sourceChannelClean && specs.source_channel !== sourceChannelClean) {
      nextSpecs.source_channel = sourceChannelClean;
      specsChanged = true;
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (specsChanged) patch.specs = nextSpecs;
    if (customerNote) {
      const existingDesc =
        typeof freshRow?.description === "string"
          ? freshRow.description.trim()
          : "";
      if (existingDesc !== customerNote) patch.description = customerNote;
    }
    const existingCrmCol =
      typeof freshRow?.crm_order_id === "string"
        ? freshRow.crm_order_id.trim()
        : "";
    if (crmOrderId && existingCrmCol !== crmOrderId) {
      patch.crm_order_id = crmOrderId;
    }

    if (Object.keys(patch).length <= 1) continue;

    const { error } = await client
      .from("orders")
      .update(patch)
      .eq("id", order.id)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[webhook/orders] CRM notes refresh error:", {
        order_id: order.id,
        message: error.message,
      });
    }
  }
}

async function refreshExistingOrderArtwork(
  client: Client,
  tenantId: string,
  existing: { id: string; title: string; specs: Record<string, unknown> }[],
  body: WebhookOrderPayload,
  items: WebhookItem[]
): Promise<void> {
  const sorted = [...existing].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true })
  );
  for (let i = 0; i < sorted.length && i < items.length; i++) {
    const order = sorted[i]!;
    const rawItem = items[i]!;
    const storedTitle =
      typeof order.specs.webhook_item_title === "string"
        ? order.specs.webhook_item_title.trim()
        : "";
    const jobTitle =
      storedTitle ||
      resolveItemTitle(
        mergeItemWithOrder(body, rawItem),
        "",
        i,
        items.length
      );
    const media = resolveWebhookItemMedia(rawItem, body, {
      jobTitle,
      totalItems: items.length,
    });
    const { skus: rawSkus, artworkBySkuId } = normalizeWebhookSkus(
      media.skus as WebhookSkuPayload[] | undefined
    );
    const existingSkus = normalizeSkus(order.specs.skus);
    const remapped = new Map<string, WebhookArtworkRef[]>();
    for (let s = 0; s < rawSkus.length; s++) {
      const refs = artworkBySkuId.get(rawSkus[s]!.id);
      if (!refs?.length) continue;
      const target =
        existingSkus.find((e) =>
          e.name.trim() &&
          rawSkus[s]!.name.trim() &&
          e.name.trim().toLowerCase() === rawSkus[s]!.name.trim().toLowerCase()
        ) ?? existingSkus[s];
      const skuId = target?.id ?? rawSkus[s]!.id;
      remapped.set(skuId, [...(remapped.get(skuId) ?? []), ...refs]);
    }
    const soleSkuId =
      existingSkus.length === 1
        ? existingSkus[0]!.id
        : rawSkus.length === 1
          ? rawSkus[0]!.id
          : null;
    await insertWebhookArtwork(client, {
      tenantId,
      orderId: order.id,
      item: { ...rawItem, ...media },
      artworkBySkuId: remapped,
      soleSkuId,
    });
  }
}

/**
 * When CRM re-fires a webhook (e.g. after-approval due materializes), update
 * existing cards instead of creating duplicates.
 */
async function updateExistingOrdersDue(
  client: Client,
  tenantId: string,
  existing: { id: string; title: string; specs: Record<string, unknown> }[],
  dueDate: string | null,
  dueSpecs: OrderDueSpecs,
  rush?: boolean
): Promise<void> {
  await Promise.all(
    existing.map(async (order) => {
      let nextDueDate = dueDate;
      let nextDueSpecs = dueSpecs;

      // CRM sent new processing days + anchor after materialization → recompute.
      if (
        dueSpecs.due_date_mode === "after_approval" &&
        dueSpecs.due_processing_days != null &&
        dueSpecs.due_anchor_at &&
        dueSpecs.due_date_status === "set" &&
        !dueDate
      ) {
        const recomputed = recomputeDueFromProcessingDays(
          { ...order.specs, ...dueSpecs },
          null,
          dueSpecs.due_processing_days
        );
        if (recomputed) {
          nextDueDate = recomputed.dueDate;
          nextDueSpecs = recomputed.specs;
        }
      }

      // Absolute date from CRM wins; merge/replace due keys cleanly.
      const nextSpecs = mergeDueSpecsIntoOrderSpecs(order.specs, nextDueSpecs);
      if (rush === true) nextSpecs.rush = true;
      else if (rush === false) nextSpecs.rush = false;
      if (nextDueDate && nextDueSpecs.due_date_status === "set") {
        // Keep prior human label only when CRM omitted one.
        if (!nextDueSpecs.due_date_label && order.specs.due_date_label) {
          nextSpecs.due_date_label = order.specs.due_date_label;
        }
      }

      const { error } = await client
        .from("orders")
        .update({
          due_date: nextDueDate,
          specs: nextSpecs,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("tenant_id", tenantId);
      if (error) {
        console.error("[webhook/orders] due-date update error:", {
          order_id: order.id,
          message: error.message,
        });
      }
    })
  );
}

/**
 * Portal partner edited an order → Order Sync re-fires the same BZ-* number.
 * Refresh product specs + custom fields on existing cards (do not create duplicates).
 */
async function refreshPortalOrdersFromWebhook(params: {
  client: Client;
  tenantId: string;
  existing: { id: string; title: string; specs: Record<string, unknown> }[];
  body: WebhookOrderPayload;
  items: WebhookItem[];
  customerName: string;
  orderContact: string;
}): Promise<void> {
  const { client, tenantId, existing, body, items, customerName, orderContact } =
    params;
  const fields = await resolveCustomFields(client, tenantId);
  const sorted = [...existing].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true })
  );
  const baseOrderNumber = resolveOrderNumber(body);
  const orderLevelTitle = resolveOrderLevelTitle(body, baseOrderNumber);
  const payloadTitle =
    typeof body.title === "string" ? body.title.trim() : "";
  const itemParentLabel =
    payloadTitle && !isOrderNumberLikeTitle(payloadTitle, baseOrderNumber)
      ? payloadTitle
      : shortOrderCardBase(baseOrderNumber);
  const portalCompanyName =
    (typeof body.company_name === "string" && body.company_name.trim()) ||
    (typeof body.company?.name === "string" && body.company.name.trim()) ||
    null;
  const portalBrokerId =
    (typeof body.bazaar_broker_id === "string" && body.bazaar_broker_id.trim()) ||
    (typeof body.company?.id === "string" && body.company.id.trim()) ||
    null;
  const rushTagId = await resolveTagId(client, tenantId, RUSH_ORDER_TAG_NAME);
  await ensureNamedTag(
    client,
    tenantId,
    DIE_REQUEST_TAG_NAME,
    "#0ea5e9",
    "Die service line — order the die from the manufacturer"
  );
  const tenantTags = await listTenantTags(client, tenantId);

  // Match each incoming line to its card by STABLE crm_line_id first, then by the
  // stored item title, and only as a last resort by position (when neither side has
  // ids and the counts are equal). This keeps a CRM edit landing on the SAME card
  // even when the line set changed between syncs (e.g. a folded design line means
  // fewer items than there are cards). Cards with no matching line are left untouched.
  const cardIdOf = (o: { id: string }) => o.id;
  const specStr = (o: { specs: Record<string, unknown> }, key: string) =>
    typeof o.specs?.[key] === "string" ? (o.specs[key] as string).trim() : "";
  const cardByLineId = new Map<string, (typeof sorted)[number]>();
  const cardByTitle = new Map<string, (typeof sorted)[number]>();
  for (const c of sorted) {
    const lid = specStr(c, "crm_line_id");
    if (lid) cardByLineId.set(lid, c);
    const wt = specStr(c, "webhook_item_title").toLowerCase();
    if (wt && !cardByTitle.has(wt)) cardByTitle.set(wt, c);
  }
  const itemLineId = (it: WebhookItem) =>
    typeof it.crm_line_id === "string" ? it.crm_line_id.trim() : "";
  const noIdsAnywhere =
    [...cardByLineId.keys()].length === 0 && items.every((it) => !itemLineId(it));
  const usedCardIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const ir = item as Record<string, unknown>;
    // Resolve which existing card this line belongs to.
    let order: (typeof sorted)[number] | null = null;
    const lid = itemLineId(item);
    const itTitle = typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
    if (lid && cardByLineId.has(lid)) order = cardByLineId.get(lid)!;
    else if (itTitle && cardByTitle.has(itTitle)) order = cardByTitle.get(itTitle)!;
    else if (noIdsAnywhere && sorted.length === items.length) order = sorted[i]!;
    if (!order || usedCardIds.has(cardIdOf(order))) continue;
    usedCardIds.add(cardIdOf(order));
    // Re-read specs after updateExistingOrdersDue so due_* keys are not wiped.
    const { data: freshRow } = await client
      .from("orders")
      .select("specs, tag_id")
      .eq("id", order.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const baseSpecs =
      freshRow?.specs && typeof freshRow.specs === "object"
        ? (freshRow.specs as Record<string, unknown>)
        : (order.specs ?? {});
    const currentTagId =
      typeof freshRow?.tag_id === "string" ? freshRow.tag_id : null;
    const nextSpecs: Record<string, unknown> = { ...baseSpecs };

    const lineSpecSelections = resolveLineSpecSelections(item, body);
    if (lineSpecSelections) {
      nextSpecs.spec_selections = lineSpecSelections;
    }
    if (Array.isArray(ir.product_options)) {
      nextSpecs.product_options = ir.product_options;
    }
    if (typeof ir.turnaround === "string" && ir.turnaround.trim()) {
      nextSpecs.turnaround = ir.turnaround.trim().toUpperCase();
    }
    if (typeof ir.turnaround_label === "string" && ir.turnaround_label.trim()) {
      nextSpecs.turnaround_label = ir.turnaround_label.trim();
    }

    // Keep board title/customer in sync with CRM-style portal payloads
    // (product as item title; partner name stays on company_name / Portal | …).
    const jobTitle = resolveItemTitle(item, itemParentLabel, i, sorted.length);
    if (jobTitle.trim()) nextSpecs.webhook_item_title = jobTitle.trim();
    // Backfill/keep the stable line id so future edits match this card by id.
    if (lid) nextSpecs.crm_line_id = lid;
    if (orderLevelTitle.trim()) nextSpecs.webhook_order_title = orderLevelTitle.trim();
    else delete nextSpecs.webhook_order_title;
    if (portalCompanyName) nextSpecs.company_name = portalCompanyName;
    if (portalBrokerId) nextSpecs.bazaar_broker_id = portalBrokerId;
    if (items.length > 1) nextSpecs.webhook_item_index = i;

    const sourceChannelClean = normalizeSourceChannel(body.source_channel);
    if (sourceChannelClean) nextSpecs.source_channel = sourceChannelClean;

    const corrections: string[] = [];
    const merged = mergeItemWithOrder(body, item);
    const media = resolveWebhookItemMedia(item, body, {
      jobTitle,
      totalItems: items.length,
    });
    const specFields = normalizeSpecFields(merged);
    // Same Admin identity mapper as createOrderFromWebhook (mapWebhookSelectValue).
    const adminIdentity = isAdminCatalogLine(item, body);
    const designNotes = resolveDesignNotes(merged);
    if (designNotes) {
      nextSpecs.designer_notes = mergeWebhookDesignerNotes(
        typeof nextSpecs.designer_notes === "string"
          ? nextSpecs.designer_notes
          : null,
        designNotes
      );
    }
    const { skus: rawSkus, artworkBySkuId } = normalizeWebhookSkus(
      media.skus as WebhookSkuPayload[] | undefined
    );
    const skus = prepareSkusForSave(rawSkus);
    // Board card qty reads specs.skus first — keep SKUs in sync on portal re-fire.
    if (skus.length > 0) {
      nextSpecs.skus = skus;
    }

    const wasRush = baseSpecs.rush === true;
    const isRush =
      webhookRushFromPayload(ir) === true ||
      webhookRushFromPayload(body as Record<string, unknown>) === true;
    if (isRush) nextSpecs.rush = true;
    else delete nextSpecs.rush;

    const patch: Record<string, unknown> = {
      specs: nextSpecs,
      updated_at: new Date().toISOString(),
    };
    if (isRush) patch.priority = "high";
    else if (wasRush) patch.priority = "normal";

    const wordTagId = !currentTagId
      ? tagIdFromItemExactWord(item, jobTitle, tenantTags)
      : null;
    if (wordTagId && !currentTagId) {
      patch.tag_id = wordTagId;
    } else if (isRush && !wasRush && rushTagId && !currentTagId) {
      patch.tag_id = rushTagId;
    } else if (wasRush && !isRush && rushTagId && currentTagId === rushTagId) {
      patch.tag_id = null;
    }

    const { error } = await client
      .from("orders")
      .update(patch)
      .eq("id", order.id)
      .eq("tenant_id", tenantId);
    if (error) {
      console.error("[webhook/orders] portal specs refresh error:", {
        order_id: order.id,
        message: error.message,
      });
    }

    const rows = buildCustomFieldValues(
      fields,
      specFields,
      customerName,
      orderContact,
      skus,
      corrections,
      adminIdentity
    );
    if (rows.length > 0) {
      const { error: cfErr } = await client.from("custom_field_values").upsert(
        rows.map((r) => ({
          order_id: order.id,
          custom_field_id: r.customFieldId,
          value: r.value,
        })),
        { onConflict: "order_id,custom_field_id" }
      );
      if (cfErr) {
        console.error("[webhook/orders] portal custom-field refresh error:", {
          order_id: order.id,
          message: cfErr.message,
        });
      }
    }

    // Ingest matching CRM/portal artwork on re-fire (idempotent inserts).
    await insertWebhookArtwork(client, {
      tenantId,
      orderId: order.id,
      item: { ...item, ...media },
      artworkBySkuId,
      soleSkuId: skus.length === 1 ? skus[0]!.id : null,
    });
    void import("@/lib/save-external-artwork")
      .then(({ saveAllExternalArtwork }) =>
        saveAllExternalArtwork({
          admin: client,
          tenantId,
          orderId: order.id,
        })
      )
      .catch((err) => {
        console.error(
          "[webhook/orders] portal artwork refresh failed:",
          err instanceof Error ? err.message : err
        );
      });
  }
}

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
  /** CRM starred / key account — stored in specs so the board can flag it. */
  isKeyAccount?: boolean;
  /** CRM rush / attention job — triangle icon + Rush Order tag. */
  isRush?: boolean;
  /** CRM `customers.id` stamped on specs for matching. */
  crmCustomerId?: string | null;
  /** CRM order id stamped on the card + specs for re-sync. */
  crmOrderId?: string | null;
  item: WebhookItem;
  priority: string;
  dueDate: string | null;
  dueSpecs: OrderDueSpecs;
  orderDescription: string | null;
  cardTitle: string;
  jobTitle: string;
  /** Parent payload title — same on every multi-item card. */
  orderLevelTitle: string;
  webhookOrderNumber: string;
  itemIndex: number;
  totalItems: number;
  tagId: string | null;
  ownerId: string | null;
  requestOwnerSpecs: Record<string, string>;
  designerId: string | null;
  designerName: string | null;
  /** Free-text notes for Designer Information custom field (not Design files). */
  designNotes: string | null;
  /** http(s) link for Design files (`specs.design_task`). CRM Files folder skips Drive create. */
  designTaskUrl: string | null;
  /** Non-URL design_task text — folded into Order Description. */
  misroutedDesignTask: string | null;
  /** Team-only Internal notes (Attention — internal). */
  internalNote: string | null;
  /** Order-level production notes fallback for flat payloads. */
  orderProductionNotes?: string | null;
  corrections: string[];
  /** Normalized source key; empty string → Integrations "other" style. */
  webhookSource: string;
  /** Payment / source link info → specs.billing (globe popover on card). */
  billing: OrderBillingInfo | null;
  /** Company default board priority (1–5) when set on the customer. */
  customerPriorityScore?: number | null;
  /** When set, do not re-route by product (keep siblings together on portal append). */
  skipProductRouting?: boolean;
  /** Bazaar Order Sync partner id (portal source). */
  portalBrokerId?: string | null;
  /** Partner/broker display name for Portal | Name label. */
  portalCompanyName?: string | null;
  /** CRM design capture — who provides artwork: has_files | files_coming | needs_design. */
  designSource?: string | null;
  /** CRM design capture — frozen design brief / reference (own card slot). */
  designReference?: string | null;
  /** Design fee (stays on the product line). */
  designPrice?: string | null;
  /** Total SKUs to design. */
  designSkuCount?: string | null;
  /** Route A: files print-ready, prepress only. */
  designReady?: boolean;
  /** CRM-named target board column. "" / null = default (start) column; a name
   *  (e.g. "Missing Info") = place the card in the column with that name. */
  initialColumn?: string | null;
  /** Origin channel of the order (email | call | sms | webform | ad_lead | ig_dm). */
  sourceChannel?: string | null;
  /** True when the customer has files but hasn't sent them yet. */
  needsCustomerFiles?: boolean;
}

/** Resolve the tenant's Missing Info column (for "files coming" design capture). */
async function resolveMissingInfoColumn(
  client: SupabaseClient,
  tenantId: string
): Promise<{ id: string; name: string | null } | null> {
  const { data } = await client
    .from("board_columns")
    .select("id, name, kind")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });
  return pickMissingInfoColumn(
    (data ?? []) as { id: string; name: string | null; kind: string | null }[]
  );
}

/**
 * Resolve a board column by its NAME (case-insensitive, trimmed) for this tenant.
 * Lets the CRM name the target column via `initial_column`. Returns null when no
 * column matches, so the caller can fall back to the default (start) column.
 */
async function resolveColumnByName(
  client: SupabaseClient,
  tenantId: string,
  name: string
): Promise<{ id: string; name: string | null } | null> {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const { data } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });
  const cols = (data ?? []) as { id: string; name: string | null }[];
  return pickColumnByName(cols, name);
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
    dueSpecs,
    orderDescription,
    cardTitle,
    jobTitle,
    orderLevelTitle,
    webhookOrderNumber,
    itemIndex,
    totalItems,
    tagId,
    ownerId,
    isKeyAccount,
    isRush,
    crmCustomerId = null,
    crmOrderId = null,
    requestOwnerSpecs,
    designerId,
    designerName,
    designNotes,
    designTaskUrl,
    misroutedDesignTask,
    internalNote,
    orderProductionNotes = null,
    corrections,
    webhookSource,
    billing,
    customerPriorityScore = null,
    portalBrokerId = null,
    portalCompanyName = null,
    skipProductRouting = false,
    designSource = null,
    designReference = null,
    designPrice = null,
    designSkuCount = null,
    designReady = false,
    initialColumn = null,
    sourceChannel = null,
    needsCustomerFiles = false,
  } = params;

  const sourceChannelClean = normalizeSourceChannel(sourceChannel);

  const designSourceClean =
    typeof designSource === "string" && designSource.trim()
      ? designSource.trim()
      : null;

  const initialColumnClean =
    typeof initialColumn === "string" && initialColumn.trim()
      ? initialColumn.trim()
      : null;

  const {
    skus: rawSkus,
    artworkBySkuId,
    skuComments,
  } = normalizeWebhookSkus(item.skus);
  const skus = prepareSkusForSave(rawSkus);

  const specFields = normalizeSpecFields(item);
  if (designNotes) {
    specFields.designer_information = designNotes;
  }

  // Same Admin identity mapper as refreshPortalOrdersFromWebhook (mapWebhookSelectValue).
  // Item already carries spec_selections (normalizeItems copies a flat body).
  const adminIdentity = isAdminCatalogLine(item);
  const customFieldValues = buildCustomFieldValues(
    fields,
    specFields,
    customerName,
    orderContact,
    skus,
    corrections,
    adminIdentity
  );

  const productField = fields.get("product");
  const productRaw = productField
    ? customFieldValues.find((v) => v.customFieldId === productField.id)?.value
    : null;
  const product =
    typeof productRaw === "string"
      ? productRaw.trim()
      : productRaw != null
        ? String(productRaw).trim()
        : "";
  const routed = skipProductRouting
    ? null
    : await resolveColumnForNewJobByProduct(
        client,
        tenantId,
        product || null
      );

  let effectiveColumnId = columnId;
  let effectiveColumnName = columnName;
  let effectivePosition = position;
  if (routed) {
    effectiveColumnId = routed.columnId;
    effectiveColumnName = routed.columnName;
    const { data: lastInTarget } = await client
      .from("orders")
      .select("position")
      .eq("column_id", routed.columnId)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    effectivePosition =
      ((lastInTarget as { position: number } | null)?.position ?? 0) + 1000;
  }

  // CRM-named target column: the CRM can name the destination column via
  // `initial_column` (empty = start/default column, handled above; a name = that
  // column). Takes precedence over the design_source fallback below. If the name
  // doesn't match any column, keep the default so an order is never dropped.
  if (initialColumnClean) {
    const named = await resolveColumnByName(client, tenantId, initialColumnClean);
    if (named) {
      effectiveColumnId = named.id;
      effectiveColumnName = named.name ?? effectiveColumnName;
      const { data: lastInNamed } = await client
        .from("orders")
        .select("position")
        .eq("column_id", named.id)
        .eq("tenant_id", tenantId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      effectivePosition =
        ((lastInNamed as { position: number } | null)?.position ?? 0) + 1000;
    }
  }

  // CRM design capture: "files coming" = artwork is missing → land the card in
  // Missing Info so the customer is asked to upload (instead of Start/design).
  // Fallback for CRM payloads sent before `initial_column` existed. Skipped when
  // the CRM named a column (even if it didn't match — that falls back to start).
  if (
    shouldApplyMissingInfoFallback({
      initialColumn: initialColumnClean,
      designSource: designSourceClean,
      needsCustomerFiles,
    })
  ) {
    const missingCol = await resolveMissingInfoColumn(client, tenantId);
    if (missingCol) {
      effectiveColumnId = missingCol.id;
      effectiveColumnName = missingCol.name ?? effectiveColumnName;
      const { data: lastInMissing } = await client
        .from("orders")
        .select("position")
        .eq("column_id", missingCol.id)
        .eq("tenant_id", tenantId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      effectivePosition =
        ((lastInMissing as { position: number } | null)?.position ?? 0) + 1000;
    }
  }

  const itemDescription =
    typeof item.description === "string" ? item.description.trim() : null;
  const orderDescriptionText =
    crmCustomerFacingNote(
      { description: orderDescription },
      { description: itemDescription }
    ) ??
    buildWebhookOrderDescription({
      orderDescription,
      itemDescription,
      misroutedDesignTask,
    });
  // CRM description → Customer note (specs.customer_facing_note + orders.description).
  const customerFacingNoteText = orderDescriptionText;
  const notesText = noteHistoryFromPlainText(internalNote, "CRM");
  const productionNotesPlain = resolveCardProductionNotes({
    item,
    skuComments,
    orderProductionNotes,
  });
  const productionNotesText = productionNotesPlain
    ? noteHistoryFromPlainText(productionNotesPlain, "CRM")
    : null;

  const specs: Record<string, unknown> = { skus, ...requestOwnerSpecs, ...dueSpecs };
  // New quote-system per-product parameters from the CRM (combos, pouches, apparel,
  // boxes). Stored additively under specs so the card can show them. (Hayk 2026-08)
  {
    const ir = item as Record<string, unknown>;
    const lineSpecSelections = resolveLineSpecSelections(item);
    if (lineSpecSelections) {
      specs.spec_selections = lineSpecSelections;
    }
    if (Array.isArray(ir.product_options) && ir.product_options.length) {
      specs.product_options = ir.product_options;
    }
    if (typeof ir.cutting_type === "string" && ir.cutting_type.trim()) {
      specs.cutting_type = ir.cutting_type.trim();
    }
    const skuQty = parseWebhookNumericQty(ir.sku_qty);
    if (skuQty != null) specs.sku_qty = skuQty;
    const qtyDetails =
      typeof ir.order_qty_details === "string" ? ir.order_qty_details.trim() : "";
    if (qtyDetails) specs.order_qty_details = qtyDetails;
  }
  if (designerId) specs.designer_id = designerId;
  if (designerName) specs.designer_name = designerName;
  if (designTaskUrl) {
    specs.design_task = designTaskUrl;
    specs.gdrive_item_folder_url = designTaskUrl;
  }
  if (designNotes) {
    specs.designer_notes = mergeWebhookDesignerNotes(null, designNotes);
  }
  if (productionNotesText) specs.production_notes = productionNotesText;
  if (customerFacingNoteText) specs.customer_facing_note = customerFacingNoteText;
  if (billing) specs.billing = billing;
  // CRM design capture — its own card slot (flag + frozen Design reference).
  if (designSourceClean) {
    specs.design_source = designSourceClean;
    specs.intake_v2 = true;
  }
  // Origin channel of the order (from the CRM lead) — shown as a chip on the card.
  if (sourceChannelClean) {
    specs.source_channel = sourceChannelClean;
  }
  if (typeof designReference === "string" && designReference.trim()) {
    specs.design_reference = designReference.trim();
  }
  if (typeof designPrice === "string" && designPrice.trim()) {
    specs.design_price = designPrice.trim();
  }
  if (typeof designSkuCount === "string" && designSkuCount.trim()) {
    specs.design_sku_count = designSkuCount.trim();
  }
  if (designReady) specs.design_ready = true;
  const sharedTitle = orderLevelTitle.trim();
  if (sharedTitle) {
    specs.webhook_order_title = sharedTitle;
  }
  if (isKeyAccount) specs.is_key_account = true;
  if (isRush) specs.rush = true;
  if (typeof crmCustomerId === "string" && crmCustomerId.trim()) {
    specs.crm_customer_id = crmCustomerId.trim();
  }
  const stampedCrmOrderId =
    typeof crmOrderId === "string" && crmOrderId.trim()
      ? crmOrderId.trim()
      : "";
  if (stampedCrmOrderId) {
    specs.crm_order_id = stampedCrmOrderId;
  }
  // Always stamp for idempotent due-date updates on later CRM webhooks.
  specs.webhook_order_number = webhookOrderNumber;
  // Stable CRM line id → lets a later CRM edit re-sync to THIS exact card by id.
  {
    const crmLineId =
      typeof (item as { crm_line_id?: unknown }).crm_line_id === "string"
        ? (item as { crm_line_id: string }).crm_line_id.trim()
        : "";
    if (crmLineId) specs.crm_line_id = crmLineId;
  }
  // Per-line display title (card + "Line item name"). Always stamp so single-item
  // orders also populate the modal field — not only multi-item parts.
  if (jobTitle.trim()) {
    specs.webhook_item_title = jobTitle.trim();
  }
  if (totalItems > 1) {
    specs.webhook_item_index = itemIndex;
  }
  if (
    typeof customerPriorityScore === "number" &&
    customerPriorityScore >= 1 &&
    customerPriorityScore <= 5
  ) {
    specs.priority_score = customerPriorityScore;
    specs.priority_source = "customer";
  }
  if (webhookSource.trim().toLowerCase() === "portal") {
    if (portalBrokerId) specs.bazaar_broker_id = portalBrokerId;
    if (portalCompanyName) specs.company_name = portalCompanyName;
  }

  const { data: order, error: orderError } = await client
    .from("orders")
    .insert({
      tenant_id: tenantId,
      column_id: effectiveColumnId,
      title: cardTitle,
      description: customerFacingNoteText,
      internal_note: notesText,
      customer_id: customerId,
      tag_id: tagId,
      priority,
      due_date: dueDate,
      specs,
      position: effectivePosition,
      created_by: ownerId,
      last_moved_at: new Date().toISOString(),
      webhook_source: webhookSource,
      crm_order_id: stampedCrmOrderId || null,
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

  if (designTaskUrl) {
    try {
      await linkExistingDriveFolderToOrder(
        client,
        tenantId,
        orderId,
        designTaskUrl
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[webhook/orders] existing Drive folder link failed:", message);
      warnings.push(`Google Drive link: ${message}`);
    }
  }

  const cfvError = await insertCustomFieldValues(
    client,
    tenantId,
    orderId,
    customFieldValues
  );
  if (cfvError) {
    warnings.push(`Custom fields could not be saved: ${cfvError}`);
  }

  const artWarnings = await insertWebhookArtwork(client, {
    tenantId,
    orderId,
    item,
    artworkBySkuId,
    soleSkuId: skus.length === 1 ? skus[0]!.id : null,
  });
  warnings.push(...artWarnings);

  // Portal artwork URLs need osk_ — pull bytes into Workflow storage in background.
  if (webhookSource.trim().toLowerCase() === "portal") {
    void import("@/lib/save-external-artwork")
      .then(({ saveAllExternalArtwork }) =>
        saveAllExternalArtwork({ admin: client, tenantId, orderId })
      )
      .then((result) => {
        if (result.failed > 0) {
          console.warn("[webhook/orders] portal artwork save partial", {
            orderId,
            saved: result.saved,
            failed: result.failed,
            results: result.results,
          });
        }
      })
      .catch((err) => {
        console.error(
          "[webhook/orders] portal artwork save failed:",
          err instanceof Error ? err.message : err
        );
      });
  }

  try {
    await logActivity(client, {
      tenantId,
      orderId,
      actor: ownerId,
      action: "created",
      metadata: {
        source: "webhook",
        webhook_source: webhookSource || null,
        title: order.title,
        column: effectiveColumnName,
        ...(routed
          ? {
              product_route: routed.product,
              product_route_column: routed.columnName,
            }
          : {}),
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
  if (isBazaarConnectionTestPayload(body)) {
    throw new WebhookValidationError(
      "Connection test only — no order is created"
    );
  }
  const customerInfo = parseWebhookCustomerInfo(body);
  validateItemsArray(body.items);
  const baseOrderNumber = resolveOrderNumber(body);
  const { dueDate, dueSpecs } = resolveDueDate(body);

  const priority =
    typeof body.priority === "string" && PRIORITIES.has(body.priority)
      ? body.priority
      : "normal";

  const isMultiItem = Array.isArray(body.items) && body.items.length > 0;
  const items = normalizeItems(body);
  const orderLevelTitle = resolveOrderLevelTitle(body, baseOrderNumber);
  const shortBaseOrderNumber = shortOrderCardBase(baseOrderNumber);
  const payloadTitle =
    typeof body.title === "string" ? body.title.trim() : "";
  const itemParentLabel =
    payloadTitle && !isOrderNumberLikeTitle(payloadTitle, baseOrderNumber)
      ? payloadTitle
      : shortBaseOrderNumber;
  const crmOrderId = crmOrderIdFromPayload(body);
  const crmCustomerId = crmCustomerIdFromPayload(body);
  const orderDescription =
    crmCustomerFacingNote(body) ??
    (typeof body.description === "string" ? body.description.trim() : null);

  const tenantId = config.tenant_id;
  let webhookSource = canonicalizeWebhookSourceKey(
    parseWebhookSourceKey(body.source)
  );
  if (!webhookSource) {
    webhookSource = canonicalizeWebhookSourceKey(
      parseWebhookSourceKey(body.source_label)
    );
  }
  if (
    !webhookSource &&
    typeof body.bazaar_broker_id === "string" &&
    body.bazaar_broker_id.trim()
  ) {
    webhookSource = "portal";
  }
  // CRM orders are ORD-YYYY-… — stamp source when the payload omitted it.
  if (!webhookSource && /^ord-\d{4}-/i.test(baseOrderNumber)) {
    webhookSource = "crm";
  }
  assertCrmOrderNumber(baseOrderNumber, webhookSource);

  // Idempotent due-date / CRM re-fire: update existing cards when found.
  const existingOrders = await findExistingWebhookOrders(
    client,
    tenantId,
    baseOrderNumber,
    shortBaseOrderNumber,
    items.length,
    crmOrderId
  );
  if (existingOrders.length > 0) {
    await updateExistingOrdersDue(
      client,
      tenantId,
      existingOrders,
      dueDate,
      dueSpecs,
      webhookRushFromPayload(body as Record<string, unknown>)
    );
    // CRM is the source of truth for contact info. Previously a CRM re-fire only
    // refreshed the due date on an existing card — so a phone/email added in the CRM
    // AFTER the order was created never reached the board (and the board has no way to
    // add it), leaving the card stuck on "contact information missing". Refresh the
    // Customer Name / Customer Contact custom fields here too so a re-push flows through.
    if (customerInfo.customerName || customerInfo.orderContact) {
      try {
        const contactFields = await resolveCustomFields(client, tenantId);
        const nameField = contactFields.get(CUSTOMER_NAME_FIELD_NAME);
        const contactField = contactFields.get(CUSTOMER_CONTACT_FIELD_NAME);
        const contactRows: { custom_field_id: string; value: unknown }[] = [];
        if (nameField && customerInfo.customerName) {
          contactRows.push({ custom_field_id: nameField.id, value: customerInfo.customerName });
        }
        if (contactField && customerInfo.orderContact) {
          contactRows.push({ custom_field_id: contactField.id, value: customerInfo.orderContact });
        }
        if (contactRows.length > 0) {
          await Promise.all(
            existingOrders.map(async (order) => {
              const { error } = await client
                .from("custom_field_values")
                .upsert(
                  contactRows.map((r) => ({
                    order_id: order.id,
                    custom_field_id: r.custom_field_id,
                    value: r.value,
                  })),
                  { onConflict: "order_id,custom_field_id" }
                );
              if (error) {
                console.error("[webhook/orders] existing-order contact refresh error:", {
                  order_id: order.id,
                  message: error.message,
                });
              }
            })
          );
        }
      } catch (err) {
        console.error(
          "[webhook/orders] existing-order contact refresh failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    try {
      await refreshExistingOrderDesignerNotes(
        client,
        tenantId,
        existingOrders,
        body,
        items
      );
    } catch (err) {
      console.error(
        "[webhook/orders] existing-order designer notes refresh failed:",
        err instanceof Error ? err.message : String(err)
      );
    }

    try {
      await refreshExistingOrderArtwork(
        client,
        tenantId,
        existingOrders,
        body,
        items
      );
    } catch (err) {
      console.error(
        "[webhook/orders] existing-order artwork refresh failed:",
        err instanceof Error ? err.message : String(err)
      );
    }

    // Portal Order Sync re-fire (partner edited the order): refresh product specs
    // + Product Specifications custom fields on the existing card(s).
    if (webhookSource === "portal") {
      try {
        await refreshPortalOrdersFromWebhook({
          client,
          tenantId,
          existing: existingOrders,
          body,
          items,
          customerName: customerInfo.customerName,
          orderContact: customerInfo.orderContact,
        });
      } catch (err) {
        console.error(
          "[webhook/orders] portal product refresh failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    } else {
      // CRM re-fire (order edited in the CRM after conversion): refresh product specs
      // + Product Specifications custom fields on the existing card(s) so the board
      // reflects the current CRM values (CRM is the source of truth). Safe on any
      // count: refreshPortalOrdersFromWebhook matches each line to its card by stable
      // crm_line_id (then title), and only falls back to positional pairing when
      // neither side carries ids AND counts are equal — so a changed line structure
      // (e.g. a folded design line) can never overwrite the wrong card.
      try {
        await refreshPortalOrdersFromWebhook({
          client,
          tenantId,
          existing: existingOrders,
          body,
          items,
          customerName: customerInfo.customerName,
          orderContact: customerInfo.orderContact,
        });
      } catch (err) {
        console.error(
          "[webhook/orders] crm product refresh failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    const needsExtraPortalLines =
      webhookSource === "portal" && items.length > existingOrders.length;

    if (!needsExtraPortalLines) {
      const sorted = [...existingOrders].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true })
      );
      const warning =
        webhookSource === "portal"
          ? "Updated existing portal order(s); no new cards created."
          : "Updated existing order(s); no new cards created.";
      if (sorted.length === 1 && items.length <= 1) {
        return {
          isMultiItem: false,
          orderId: sorted[0].id,
          orderNumber: baseOrderNumber,
          ownerId: null,
          ownerName: null,
          warning,
        };
      }
      return {
        isMultiItem: true,
        orderNumber: baseOrderNumber,
        jobs: sorted.map((o, index) => ({
          order_id: o.id,
          item_index: index,
          title: o.title,
        })),
        ownerId: null,
        ownerName: null,
        warning,
      };
    }

    // Promote single-line title BZ-100 → BZ-100-1 before creating BZ-100-2+.
    if (existingOrders.length === 1 && items.length > 1) {
      const only = existingOrders[0]!;
      if (
        only.title === shortBaseOrderNumber ||
        only.title === baseOrderNumber
      ) {
        const nextTitle = `${shortBaseOrderNumber}-1`;
        const nextSpecs = {
          ...only.specs,
          webhook_item_index: 0,
        };
        const { error: renameErr } = await client
          .from("orders")
          .update({
            title: nextTitle,
            specs: nextSpecs,
            updated_at: new Date().toISOString(),
          })
          .eq("id", only.id)
          .eq("tenant_id", tenantId);
        if (renameErr) {
          console.error("[webhook/orders] portal line-1 rename error:", {
            order_id: only.id,
            message: renameErr.message,
          });
        } else {
          only.title = nextTitle;
          only.specs = nextSpecs;
        }
      }
    }
  }

  const startCreateIndex =
    existingOrders.length > 0 && webhookSource === "portal"
      ? existingOrders.length
      : 0;
  const refreshedExistingJobs: WebhookCreatedJob[] =
    startCreateIndex > 0
      ? [...existingOrders]
          .sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { numeric: true })
          )
          .map((o, index) => ({
            order_id: o.id,
            item_index: index,
            title: o.title,
          }))
      : [];

  const { data: firstCol } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  let columnId = (firstCol as { id: string; name: string } | null)?.id;
  let columnName =
    (firstCol as { id: string; name: string } | null)?.name ?? null;

  // Portal append: place new line cards with their siblings, not column 1.
  if (startCreateIndex > 0 && existingOrders[0]?.id) {
    const { data: sibling } = await client
      .from("orders")
      .select("column_id")
      .eq("id", existingOrders[0].id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const siblingColumnId =
      typeof sibling?.column_id === "string" ? sibling.column_id : null;
    if (siblingColumnId) {
      const { data: siblingCol } = await client
        .from("board_columns")
        .select("id, name")
        .eq("id", siblingColumnId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (siblingCol?.id) {
        columnId = siblingCol.id as string;
        columnName = (siblingCol.name as string | null) ?? columnName;
      }
    }
  }

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
  let customerPriorityScore: number | null = null;
  if (customerInfo.customerEmail || customerInfo.customerPhone) {
    try {
      const { customerId: id } = await upsertCustomer(client, tenantId, {
        name: customerInfo.customerName,
        email: customerInfo.customerEmail,
        phone: customerInfo.customerPhone,
      });
      customerId = id;
      customerPriorityScore = await getCustomerDefaultPriorityScore(
        client,
        tenantId,
        id
      );
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

  const orderTagName = body.category ?? body.category_name;
  const defaultTagId = await resolveTagId(
    client,
    tenantId,
    orderTagName
  );
  await ensureNamedTag(
    client,
    tenantId,
    DIE_REQUEST_TAG_NAME,
    "#0ea5e9",
    "Die service line — order the die from the manufacturer"
  );
  const tenantTags = await listTenantTags(client, tenantId);

  const orderLevelBilling = parseWebhookBilling({
    source_url: body.source_url,
    source_link: body.source_link,
    order_url: body.order_url,
    payment_status: body.payment_status,
    payment: body.payment,
    deposit: body.deposit,
    balance: body.balance,
  });

  // Per-card Notes: keep line-item comments on their own cards. CRM sometimes
  // concatenates every line comment into order-level notes (see ORD-2026-0486)
  // while also putting each line's text on skus[0].comment.
  const sharedAttention = resolveSharedAttentionForItems(body, items);
  const itemsHaveOwnNotes = items.some((it) =>
    Boolean(resolveItemOwnAttentionNote(it, null))
  );
  const splitFromNotes =
    items.length > 1 && !itemsHaveOwnNotes
      ? splitAggregatedLineNotes(resolveSharedAttentionNote(body), items.length)
      : null;
  const orderMisroutedDesignTask = resolveMisroutedDesignTaskText(body);
  const splitFromDesignTask =
    items.length > 1 && !itemsHaveOwnNotes
      ? splitAggregatedLineNotes(orderMisroutedDesignTask, items.length)
      : null;

  // When appending portal lines on re-fire, treat as multi-item for titles.
  const createAsMultiItem = isMultiItem || startCreateIndex > 0;

  for (let i = startCreateIndex; i < items.length; i++) {
    const rawItem = items[i];
    const merged = mergeItemWithOrder(body, rawItem);
    const jobTitle = resolveItemTitle(merged, itemParentLabel, i, items.length);
    const item = {
      ...merged,
      ...resolveWebhookItemMedia(rawItem, body, {
        jobTitle,
        totalItems: items.length,
      }),
    };
    const cardTitle = createAsMultiItem
      ? `${shortBaseOrderNumber}-${i + 1}`
      : shortBaseOrderNumber;

    const itemTagName = item.category ?? item.category_name;
    let tagId = itemTagName
      ? await resolveTagId(client, tenantId, itemTagName)
      : null;
    if (!tagId) {
      tagId = tagIdFromItemExactWord(item, jobTitle, tenantTags);
    }
    if (!tagId) {
      tagId = defaultTagId;
    }
    const isRush = webhookRushFromPayload(item as Record<string, unknown>) === true;
    if (isRush && !tagId) {
      tagId = await resolveTagId(client, tenantId, RUSH_ORDER_TAG_NAME);
    }

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

    const itemBilling = parseWebhookBilling({
      source_url: item.source_url,
      source_link: item.source_link,
      order_url: item.order_url,
      payment_status: item.payment_status,
      payment: item.payment,
      deposit: item.deposit,
      balance: item.balance,
    });
    // Item-level fields override order-level when present.
    const mergedBilling: OrderBillingInfo | null =
      itemBilling || orderLevelBilling
        ? {
            source_url:
              itemBilling?.source_url ?? orderLevelBilling?.source_url ?? null,
            payment_status:
              itemBilling?.payment_status ??
              orderLevelBilling?.payment_status ??
              null,
            deposit: itemBilling?.deposit ?? orderLevelBilling?.deposit ?? null,
            balance: itemBilling?.balance ?? orderLevelBilling?.balance ?? null,
          }
        : null;
    const billing = hasBillingInfo(mergedBilling) ? mergedBilling : null;

    const portalBrokerId =
      (typeof body.bazaar_broker_id === "string" && body.bazaar_broker_id.trim()) ||
      (typeof body.company?.id === "string" && body.company.id.trim()) ||
      null;
    const portalCompanyName =
      (typeof body.company_name === "string" && body.company_name.trim()) ||
      (typeof body.company?.name === "string" && body.company.name.trim()) ||
      null;

    const { attention: combinedAttention, suppressMisroutedDesignTask } =
      resolveCardAttentionNotes({
        items,
        itemIndex: i,
        sharedAttention,
        splitFromNotes,
        splitFromDesignTask,
      });
    const misroutedDesignTask = suppressMisroutedDesignTask
      ? null
      : resolveMisroutedDesignTaskText(designerInput);

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
      isKeyAccount: body.is_key_account === true,
      crmCustomerId: crmCustomerId ?? "",
      crmOrderId: crmOrderId ?? "",
      isRush,
      item,
      priority,
      dueDate,
      dueSpecs,
      orderDescription,
      cardTitle,
      jobTitle,
      orderLevelTitle,
      webhookOrderNumber: baseOrderNumber,
      itemIndex: i,
      totalItems: items.length,
      tagId,
      ownerId,
      requestOwnerSpecs,
      designerId,
      designerName,
      designNotes: resolveDesignNotes(designerInput),
      designTaskUrl: resolveWebhookLineFolderUrl(
        item as unknown as Record<string, unknown>,
        body as unknown as Record<string, unknown>
      ),
      misroutedDesignTask,
      internalNote: combinedAttention,
      orderProductionNotes: pickTrimmedNote(
        body.production_notes,
        body.notes_for_production,
        body.line_item_comment
      ),
      corrections: allCorrections,
      webhookSource,
      billing,
      customerPriorityScore,
      portalBrokerId,
      portalCompanyName,
      skipProductRouting: startCreateIndex > 0,
      designSource:
        typeof body.design_source === "string" ? body.design_source.trim() : null,
      designReference:
        typeof body.design_reference === "string" ? body.design_reference.trim() : null,
      designPrice:
        typeof body.design_price === "string" ? body.design_price.trim() : null,
      designSkuCount:
        typeof body.design_sku_count === "string" ? body.design_sku_count.trim() : null,
      designReady: body.design_ready === true,
      initialColumn:
        typeof body.initial_column === "string" ? body.initial_column.trim() : null,
      sourceChannel: body.source_channel,
      needsCustomerFiles: body.needs_customer_files === true,
    });

    nextPosition += 1000;
    allWarnings.push(...result.warnings);
    createdJobs.push({
      order_id: result.orderId,
      item_index: i,
      title: result.title,
    });
  }

  if (startCreateIndex > 0) {
    allWarnings.unshift(
      `Updated existing portal order(s); created ${createdJobs.length} new line card(s).`
    );
  }

  if (allCorrections.length > 0) {
    allWarnings.push(
      `Auto-corrected fields: ${allCorrections.join("; ")}`
    );
  }

  // Drive folders: one tree per card for multi-item (`…_1`, `…_2`); shared link no longer.
  if (createdJobs.length > 0) {
    try {
      const { data: createdOrders } = await client
        .from("orders")
        .select("id, title, customer_id, specs")
        .eq("tenant_id", tenantId)
        .in(
          "id",
          createdJobs.map((j) => j.order_id)
        );
      const gdrive = await attachGdriveFoldersToOrders(
        client,
        tenantId,
        (createdOrders ?? []) as Array<{
          id: string;
          title: string;
          customer_id?: string | null;
          specs?: Record<string, unknown> | null;
        }>
      );
      if (gdrive?.warning) allWarnings.push(gdrive.warning);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[webhook/orders] gdrive error:", message);
      allWarnings.push(`Google Drive: ${message}`);
    }
  }

  const warning =
    allWarnings.length > 0 ? allWarnings.join("; ") : undefined;
  const allJobs = [...refreshedExistingJobs, ...createdJobs];

  if (createAsMultiItem || allJobs.length > 1) {
    return {
      isMultiItem: true,
      orderNumber: baseOrderNumber,
      jobs: allJobs,
      ownerId: responseOwnerId,
      ownerName: responseOwnerName,
      warning,
    };
  }

  return {
    isMultiItem: false,
    orderId: allJobs[0]!.order_id,
    orderNumber: baseOrderNumber,
    ownerId: responseOwnerId,
    ownerName: responseOwnerName,
    warning,
  };
}
