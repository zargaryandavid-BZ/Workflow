/**
 * Die library (`public.dies`). Pure helpers shared by the Die Order page,
 * the /api/dies routes and tests.
 */

export const DIE_TYPES = ["label", "paper", "box", "other"] as const;
export type DieType = (typeof DIE_TYPES)[number];
export const DIE_TYPE_LABEL: Record<DieType, string> = {
  label: "Label",
  paper: "Paper",
  box: "Box",
  other: "Other",
};

export const DIE_SHAPES = ["square", "round", "custom"] as const;
export type DieShape = (typeof DIE_SHAPES)[number];
export const DIE_SHAPE_LABEL: Record<DieShape, string> = {
  square: "Square",
  round: "Round",
  custom: "Custom",
};

export type Die = {
  id: string;
  name: string;
  die_type: DieType;
  order_id: string | null;
  order_title: string | null;
  customer_name: string | null;
  /** Company that made / was asked to make the die. */
  manufacturer_name: string | null;
  /** Shelf / bin where the die is kept (migration 0097). */
  location: string | null;
  pacdora_template_name: string | null;
  pacdora_link: string | null;
  template_code: string;
  length: number | null;
  width: number | null;
  height: number | null;
  shape: DieShape;
  rounded_corner: boolean;
  perforation: boolean;
  /** Die PDF attached in the popup (migration 0095). */
  pdf_name: string | null;
  has_pdf: boolean;
  manufacturer_id: string | null;
  /** Working or Out of order. Missing column reads as working. */
  shop_status: DieShopStatus;
  /** Usage (migration 0096). Each "Use die" counts one use. */
  max_uses: number | null;
  use_count: number;
  last_used_at: string | null;
  /** Who has the die right now (Use die → Return die). */
  checked_out_by: string | null;
  checked_out_by_name: string | null;
  checked_out_at: string | null;
  /** Ordered from a manufacturer and not received yet (Requests tab only). */
  on_order: boolean;
  /** Set when the die was deleted (kept so its Template ID is never reused). */
  deleted_at: string | null;
  /** When this die was ordered. Reorder replaces this; it does not email anyone. */
  ordered_at: string;
  created_at: string;
};

export const DIE_SHOP_STATUSES = ["working", "out_of_order"] as const;
export type DieShopStatus = (typeof DIE_SHOP_STATUSES)[number];

export const DIE_SHOP_STATUS_LABEL: Record<DieShopStatus, string> = {
  working: "Working",
  out_of_order: "Out of order",
};

/** "problem" (before migration 0096) reads as Out of order. */
export function parseDieShopStatus(raw: unknown): DieShopStatus | null {
  if (raw === "working") return "working";
  if (raw === "out_of_order" || raw === "problem") return "out_of_order";
  return null;
}

/**
 * A small save from the Dies table: status and/or reorder.
 * A full Add/Edit form (has `name`) is not this patch.
 */
export function parseDieShopPatch(
  body: Record<string, unknown>
):
  | { kind: "form" }
  | { kind: "shop"; shopStatus: DieShopStatus | null; reorder: boolean }
  | { kind: "error"; error: string } {
  const reorder = body.reorder === true;
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "shop_status");
  if (!reorder && !hasStatus) return { kind: "form" };
  if (typeof body.name === "string") return { kind: "form" };
  let shopStatus: DieShopStatus | null = null;
  if (hasStatus) {
    shopStatus = parseDieShopStatus(body.shop_status);
    if (!shopStatus) return { kind: "error", error: "Status must be Working or Out of order." };
  }
  if (!reorder && !shopStatus) return { kind: "error", error: "Status must be Working or Out of order." };
  return { kind: "shop", shopStatus, reorder };
}

/** Instant stamped when someone reorders a die. */
export function reorderOrderedAt(now: Date): string {
  return now.toISOString();
}

/** What the Add / Edit Die popup sends. */
export type DieInput = {
  name: string;
  die_type: DieType;
  order_id: string | null;
  pacdora_template_name: string | null;
  pacdora_link: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  shape: DieShape;
  rounded_corner: boolean;
  perforation: boolean;
  manufacturer_id: string | null;
  /** Max number of uses before the die should be replaced; null = no limit. */
  max_uses: number | null;
  /** Shelf / bin, e.g. "Shelf B · Bin 4". */
  location: string | null;
};

export const DIE_CODE_PREFIX = "DIE-";

/** 1 → "DIE-00001" (grows past 5 digits when needed). */
export function formatDieCode(n: number): string {
  return `${DIE_CODE_PREFIX}${String(Math.max(1, Math.floor(n))).padStart(5, "0")}`;
}

/** Next free code after the highest DIE-##### already used. */
export function nextDieCode(existing: string[]): string {
  let max = 0;
  for (const code of existing) {
    const m = /^DIE-(\d+)$/i.exec(code.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatDieCode(max + 1);
}

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const value = String(raw).trim().slice(0, max);
  return value || null;
}

function dim(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) return { ok: false };
  return { ok: true, value: n };
}

function bool(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "on" || raw === "yes";
}

/** http(s) links only; "pacdora.com/…" gets https:// added. */
export function normalizeDieLink(raw: unknown): string | null | "invalid" {
  const value = text(raw, 1000);
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "invalid";
    return url.toString();
  } catch {
    return "invalid";
  }
}

export function parseDieInput(
  body: Record<string, unknown>
): { ok: true; value: DieInput } | { ok: false; error: string } {
  const name = text(body.name, 200);
  if (!name) return { ok: false, error: "Die name is required." };

  const dieType = DIE_TYPES.includes(body.die_type as DieType)
    ? (body.die_type as DieType)
    : null;
  if (!dieType) return { ok: false, error: "Pick a die type." };

  const shape = DIE_SHAPES.includes(body.shape as DieShape)
    ? (body.shape as DieShape)
    : null;
  if (!shape) return { ok: false, error: "Pick a shape." };

  const length = dim(body.length);
  const width = dim(body.width);
  const height = dim(body.height);
  if (!length.ok || !width.ok || !height.ok) {
    return { ok: false, error: "L, W and H must be positive numbers." };
  }

  const link = normalizeDieLink(body.pacdora_link);
  if (link === "invalid") {
    return { ok: false, error: "Pacdora link must be a web address (https://…)." };
  }

  const maxUses = parseMaxUses(body.max_uses);
  if (!maxUses.ok) {
    return { ok: false, error: "Max uses must be a whole number above 0." };
  }

  const orderId = text(body.order_id, 64);
  return {
    ok: true,
    value: {
      name,
      die_type: dieType,
      order_id: orderId,
      pacdora_template_name: text(body.pacdora_template_name, 200),
      pacdora_link: link,
      length: length.value,
      width: width.value,
      height: height.value,
      shape,
      rounded_corner: bool(body.rounded_corner),
      perforation: bool(body.perforation),
      manufacturer_id: text(body.manufacturer_id, 64),
      max_uses: maxUses.value,
      location: text(body.location, 120),
    },
  };
}

export function formatDieLwh(die: Pick<Die, "length" | "width" | "height">): string {
  const parts = [die.length, die.width, die.height].map((v) =>
    v == null ? "—" : String(v)
  );
  return parts.every((p) => p === "—") ? "—" : parts.join(" × ");
}

export function mapDieRow(row: Record<string, unknown>): Die {
  const order = row.order as
    | {
        title?: string;
        customer?: { name?: string | null } | { name?: string | null }[] | null;
      }
    | {
        title?: string;
        customer?: { name?: string | null } | { name?: string | null }[] | null;
      }[]
    | null;
  const relatedOrder = Array.isArray(order) ? order[0] : order;
  const orderTitle = relatedOrder?.title;
  const customer = Array.isArray(relatedOrder?.customer)
    ? relatedOrder.customer[0]
    : relatedOrder?.customer;
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    die_type: DIE_TYPES.includes(row.die_type as DieType)
      ? (row.die_type as DieType)
      : "other",
    order_id: row.order_id ? String(row.order_id) : null,
    order_title: orderTitle ?? null,
    customer_name: customer?.name?.trim() || null,
    manufacturer_name: (() => {
      const m = row.manufacturer as { full_name?: string } | { full_name?: string }[] | null;
      const one = Array.isArray(m) ? m[0] : m;
      return one?.full_name?.trim() || null;
    })(),
    pacdora_template_name: row.pacdora_template_name
      ? String(row.pacdora_template_name)
      : null,
    pacdora_link: row.pacdora_link ? String(row.pacdora_link) : null,
    template_code: String(row.template_code ?? ""),
    length: num(row.length),
    width: num(row.width),
    height: num(row.height),
    shape: DIE_SHAPES.includes(row.shape as DieShape)
      ? (row.shape as DieShape)
      : "square",
    rounded_corner: row.rounded_corner === true,
    perforation: row.perforation === true,
    pdf_name: row.pdf_name ? String(row.pdf_name) : null,
    location: row.location ? String(row.location).trim() || null : null,
    has_pdf: Boolean(row.pdf_path),
    manufacturer_id: row.manufacturer_id ? String(row.manufacturer_id) : null,
    shop_status: parseDieShopStatus(row.shop_status) ?? "working",
    max_uses: num(row.max_uses),
    use_count: Number(row.use_count ?? 0) || 0,
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    checked_out_by: row.checked_out_by ? String(row.checked_out_by) : null,
    checked_out_by_name: row.checked_out_by_name ? String(row.checked_out_by_name) : null,
    checked_out_at: row.checked_out_at ? String(row.checked_out_at) : null,
    on_order: row.on_order === true,
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
    ordered_at: row.ordered_at
      ? String(row.ordered_at)
      : String(row.created_at ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

/** Postgres "relation does not exist" / PostgREST schema-cache misses for the dies table. */
export function isMissingDiesTable(message: string | null | undefined): boolean {
  return /relation .*dies.* does not exist|could not find the table .*dies|schema cache.*dies|public\.dies/i.test(
    message ?? ""
  );
}

export const DIE_PDF_MIGRATION_HINT =
  "Run migration 0095_die_pdf_manufacturer.sql in Supabase to attach die PDFs.";

export const DIES_MIGRATION_HINT =
  "Run migration 0093_dies.sql in Supabase, then try again.";

/**
 * Dies tab: every die except one ordered from a manufacturer that hasn't
 * been received yet (that one is only on the Requests tab).
 */
export function dieShowsInLibrary(die: Pick<Die, "on_order">): boolean {
  return !die.on_order;
}

function parseMaxUses(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) return { ok: false };
  return { ok: true, value: n };
}

export type DieUsageLevel = "none" | "ok" | "near" | "over";

/** "near" from 90% of max uses, "over" once the max is reached. */
export function dieUsageLevel(die: Pick<Die, "use_count" | "max_uses">): DieUsageLevel {
  if (!die.max_uses) return "none";
  if (die.use_count >= die.max_uses) return "over";
  if (die.use_count >= die.max_uses * 0.9) return "near";
  return "ok";
}

export function formatDieUses(die: Pick<Die, "use_count" | "max_uses">): string {
  return die.max_uses
    ? `${die.use_count.toLocaleString("en-US")} / ${die.max_uses.toLocaleString("en-US")}`
    : die.use_count.toLocaleString("en-US");
}

/** Why "Use die" can't run now, or null when it can. */
export function dieUseBlocker(
  die: Pick<Die, "shop_status" | "checked_out_at" | "checked_out_by_name" | "on_order"> &
    Partial<Pick<Die, "deleted_at">>
): string | null {
  if (die.deleted_at) return "This die was deleted.";
  if (die.on_order) return "This die hasn't been received yet.";
  if (die.shop_status === "out_of_order") return "This die is out of order.";
  if (die.checked_out_at) {
    return `${die.checked_out_by_name || "Someone"} already has this die. Return it first.`;
  }
  return null;
}

export const DIE_EVENT_KINDS = [
  "added",
  "ordered",
  "received",
  "used",
  "returned",
  "status",
  "reorder",
  "edited",
  "deleted",
  "reminded",
] as const;
export type DieEventKind = (typeof DIE_EVENT_KINDS)[number];

export type DieEvent = {
  id: string;
  kind: DieEventKind;
  actor_name: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

/** One line for the history list. */
export function dieEventLabel(event: Pick<DieEvent, "kind" | "meta">): string {
  const meta = event.meta ?? {};
  switch (event.kind) {
    case "added":
      return "Die added";
    case "ordered":
      return meta.manufacturer ? `Ordered from ${String(meta.manufacturer)}` : "Ordered from manufacturer";
    case "received":
      return "Die received";
    case "used": {
      const parts = [
        meta.order_number ? `Used for order ${String(meta.order_number)}` : "Taken for use",
        Number(meta.uses_added) > 1 ? `+${String(meta.uses_added)} uses` : null,
        meta.use_number ? `total ${String(meta.use_number)}` : null,
      ].filter(Boolean);
      return parts.join(" · ");
    }
    case "returned":
      return "Returned";
    case "status":
      return meta.to === "out_of_order" ? "Marked out of order" : "Marked working";
    case "reorder":
      return "Reordered";
    case "edited":
      return "Details edited";
    case "deleted":
      return "Die deleted";
    case "reminded":
      return meta.manufacturer
        ? `Reminder sent to ${String(meta.manufacturer)}`
        : "Reminder sent to manufacturer";
  }
}

/** Die QR codes open the die page: /dies/DIE-00001. */
export function dieQrPath(templateCode: string): string {
  return `/dies/${encodeURIComponent(templateCode)}`;
}

/** "DIE-00001", a die URL, or a scanned QR → the Template ID, else null. */
export function parseDieCodeInput(raw: string): string | null {
  const m = /\b(DIE-\d{1,9})\b/i.exec(raw.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export const DIE_PDF_MAX_BYTES = 50 * 1024 * 1024;

/** PDF only (by type or .pdf name), under 50 MB. */
export function diePdfError(file: { name: string; type: string; size: number }): string | null {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "The die file must be a PDF.";
  if (file.size <= 0) return "That PDF is empty.";
  if (file.size > DIE_PDF_MAX_BYTES) return "The die PDF must be 50 MB or smaller.";
  return null;
}
