/**
 * Outsource purchase orders (Hayk #14). Pure helpers: pre-fill a PO from a
 * card, validate edits, and build the vendor emails. No I/O here.
 */
import { buildRespondOrderRows } from "./respond-order.ts";
import { normalizeSkus } from "./skus.ts";

export const BAZAAR_SHIP_TO = "Bazaar Printing\n306 Boyd St\nLos Angeles, CA 90013";

export const PO_STATUSES = [
  "draft",
  "sent",
  "update_requested",
  "confirmed",
  "shipped",
  "received",
  "cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** Statuses a vendor may set from their link. */
export const VENDOR_STATUSES = ["confirmed", "in_production", "shipped"] as const;

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent to vendor",
  update_requested: "Update requested",
  confirmed: "Vendor confirmed",
  in_production: "In production at vendor",
  shipped: "Vendor shipped",
  received: "Received",
  cancelled: "Cancelled",
};

export type PoItem = {
  description: string;
  specs: string;
  qty: number | null;
  unit_cost: number | null;
};

export type PoHistoryEntry = {
  at: string;
  by: string;
  action: string;
  note?: string | null;
};

export function poNumberForOrder(orderTitle: string, existingCount: number): string {
  const base = `PO-${(orderTitle || "ORDER").trim().replace(/\s+/g, "-")}`;
  return existingCount > 0 ? `${base}-${existingCount + 1}` : base;
}

const SPEC_SKIP = new Set(["designer", "quantity", "product", "category"]);

/** Pre-fill PO lines from the card: one line per SKU (or one for the job). */
export function defaultPoItems(params: {
  fields: Record<string, unknown>;
  specs: Record<string, unknown>;
}): PoItem[] {
  const { fields, specs } = params;
  const rows = buildRespondOrderRows(null, fields, specs);
  const product =
    rows.find((r) => r.label.toLowerCase() === "product")?.value ||
    (typeof specs.webhook_item_title === "string" ? specs.webhook_item_title : "") ||
    "Item";
  const specText = rows
    .filter((r) => !SPEC_SKIP.has(r.label.toLowerCase()))
    .map((r) => `${r.label}: ${r.value}`)
    .join("; ");
  const qtyRaw = rows.find((r) => r.label.toLowerCase() === "quantity")?.value;
  const totalQty = qtyRaw != null && qtyRaw !== "" && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;

  const skus = normalizeSkus(specs.skus).filter((s) => s.name.trim() || s.qty != null);
  if (skus.length > 1) {
    return skus.map((s, i) => ({
      description: `${product} — ${s.name.trim() || `SKU ${i + 1}`}`,
      specs: specText,
      qty: s.qty,
      unit_cost: null,
    }));
  }
  return [
    {
      description: product,
      specs: specText,
      qty: skus[0]?.qty ?? totalQty,
      unit_cost: null,
    },
  ];
}

export function poTotal(items: PoItem[]): number | null {
  let total = 0;
  let any = false;
  for (const it of items) {
    if (it.qty != null && it.unit_cost != null) {
      total += it.qty * it.unit_cost;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function sanitizePoItems(raw: unknown): PoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      description: String(r.description ?? "").trim().slice(0, 500),
      specs: String(r.specs ?? "").trim().slice(0, 2000),
      qty: num(r.qty),
      unit_cost: num(r.unit_cost),
    }))
    .filter((r) => r.description || r.specs || r.qty != null);
}

/** "Artwork (GDrive link)" field, else the line folder from the CRM payload. */
export function orderFolderUrl(
  fields: Record<string, unknown>,
  specs: Record<string, unknown>
): string | null {
  for (const [k, v] of Object.entries(fields)) {
    if (/artwork|gdrive|drive/i.test(k) && typeof v === "string" && /^https?:\/\//.test(v.trim())) {
      return v.trim();
    }
  }
  for (const key of ["item_folder_url", "files_url", "final_production_url", "artwork_url"]) {
    const v = specs[key];
    if (typeof v === "string" && /^https?:\/\//.test(v.trim())) return v.trim();
  }
  return null;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number | null): string {
  return n == null ? "" : `$${n.toFixed(2)}`;
}

export type PoEmailInput = {
  poNumber: string;
  vendorContact: string | null;
  items: PoItem[];
  shipTo: string | null;
  dueDate: string | null;
  notes: string | null;
  folderUrl: string | null;
  vendorUrl: string;
  fromName: string;
};

export function poEmailSubject(poNumber: string): string {
  return `Purchase Order ${poNumber} — Bazaar Printing`;
}

export function poUpdateSubject(poNumber: string): string {
  return `Status update request — ${poNumber}`;
}

export function buildPoEmailText(p: PoEmailInput): string {
  const lines = [
    `Hi${p.vendorContact ? ` ${p.vendorContact}` : ""},`,
    "",
    `Please see purchase order ${p.poNumber} below.`,
    "",
    ...p.items.map(
      (it, i) =>
        `${i + 1}. ${it.description}${it.qty != null ? ` — Qty ${it.qty}` : ""}${
          it.unit_cost != null ? ` @ ${money(it.unit_cost)}` : ""
        }${it.specs ? `\n   ${it.specs}` : ""}`
    ),
    "",
    poTotal(p.items) != null ? `Total: ${money(poTotal(p.items))}` : "",
    p.dueDate ? `Needed by: ${p.dueDate}` : "",
    p.shipTo ? `Ship to:\n${p.shipTo}` : "",
    p.notes ? `\nNotes: ${p.notes}` : "",
    p.folderUrl ? `\nPrint files: ${p.folderUrl}` : "",
    "",
    `Confirm the order and post updates here: ${p.vendorUrl}`,
    "",
    `Thank you,\n${p.fromName}\nBazaar Printing`,
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export function buildPoEmailHtml(p: PoEmailInput): string {
  const rows = p.items
    .map(
      (it, i) => `<tr>
<td style="padding:6px;border:1px solid #e2e8f0;vertical-align:top">${i + 1}</td>
<td style="padding:6px;border:1px solid #e2e8f0;vertical-align:top"><b>${esc(it.description)}</b>${
        it.specs ? `<br><span style="color:#475569;font-size:12px">${esc(it.specs)}</span>` : ""
      }</td>
<td style="padding:6px;border:1px solid #e2e8f0;text-align:right;vertical-align:top">${it.qty ?? ""}</td>
<td style="padding:6px;border:1px solid #e2e8f0;text-align:right;vertical-align:top">${money(it.unit_cost)}</td>
</tr>`
    )
    .join("");
  const total = poTotal(p.items);
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;max-width:680px">
<p>Hi${p.vendorContact ? ` ${esc(p.vendorContact)}` : ""},</p>
<p>Please see purchase order <b>${esc(p.poNumber)}</b> below.</p>
<table style="border-collapse:collapse;width:100%;font-size:13px">
<tr style="background:#f1f5f9"><th style="padding:6px;border:1px solid #e2e8f0">#</th><th style="padding:6px;border:1px solid #e2e8f0;text-align:left">Item</th><th style="padding:6px;border:1px solid #e2e8f0">Qty</th><th style="padding:6px;border:1px solid #e2e8f0">Unit cost</th></tr>
${rows}
${total != null ? `<tr><td colspan="3" style="padding:6px;text-align:right"><b>Total</b></td><td style="padding:6px;text-align:right"><b>${money(total)}</b></td></tr>` : ""}
</table>
${p.dueDate ? `<p><b>Needed by:</b> ${esc(p.dueDate)}</p>` : ""}
${p.shipTo ? `<p><b>Ship to:</b><br>${esc(p.shipTo).replace(/\n/g, "<br>")}</p>` : ""}
${p.notes ? `<p><b>Notes:</b> ${esc(p.notes)}</p>` : ""}
${p.folderUrl ? `<p><b>Print files:</b> <a href="${esc(p.folderUrl)}">Open file folder</a></p>` : ""}
<p><a href="${esc(p.vendorUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Confirm order &amp; post updates</a></p>
<p>Thank you,<br>${esc(p.fromName)}<br>Bazaar Printing</p>
</div>`;
}

export function buildPoUpdateText(p: {
  poNumber: string;
  vendorContact: string | null;
  vendorUrl: string;
  message: string | null;
  fromName: string;
}): string {
  return [
    `Hi${p.vendorContact ? ` ${p.vendorContact}` : ""},`,
    "",
    `Could you send us a status update on purchase order ${p.poNumber}?`,
    p.message ? `\n${p.message}` : "",
    "",
    `Post the update (status, ship date, tracking) here: ${p.vendorUrl}`,
    "",
    `Thank you,\n${p.fromName}\nBazaar Printing`,
  ].join("\n");
}

export function buildPoUpdateHtml(p: {
  poNumber: string;
  vendorContact: string | null;
  vendorUrl: string;
  message: string | null;
  fromName: string;
}): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
<p>Hi${p.vendorContact ? ` ${esc(p.vendorContact)}` : ""},</p>
<p>Could you send us a status update on purchase order <b>${esc(p.poNumber)}</b>?</p>
${p.message ? `<p>${esc(p.message)}</p>` : ""}
<p><a href="${esc(p.vendorUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Post an update</a></p>
<p>Thank you,<br>${esc(p.fromName)}<br>Bazaar Printing</p>
</div>`;
}
