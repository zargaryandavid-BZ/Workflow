/**
 * Full-card summary for GET /api/export/order-card. PURE so it runs under
 * `node --test`. It carries what the board card / job ticket shows (category,
 * product, materials, width/height, finishing, sides, roll direction, SKUs…)
 * to a downstream shop system such as Pulse, and deliberately OMITS customer
 * contact details (email / phone) and any pricing.
 */

export type OrderCardSource = {
  order: { id: string; title: string; due_date: string | null };
  columnName: string;
  tagName: string | null;
  specRows: { label: string; value: string }[];
  skuRows: {
    index: number;
    name: string;
    qty: number | null;
    imageLinks: string[];
  }[];
  totalQty: number | null;
  customerName: string;
  ownerName: string | null;
  designerName: string | null;
  product: string;
  die: string;
  artworkLink: string;
  designTask: string;
  dueDateFormatted: string;
  productionDateFormatted: string | null;
  applicationEnabled: boolean;
  priority: string;
};

export type OrderCardExport = {
  order_id: string;
  order_number: string;
  column_name: string;
  customer_name: string | null;
  owner: string | null;
  designer: string | null;
  priority: string | null;
  tag: string | null;
  due_date: string | null;
  due_date_display: string | null;
  production_date: string | null;
  application_enabled: boolean;
  total_qty: number | null;
  product: string | null;
  die: string | null;
  artwork_link: string | null;
  design_task: string | null;
  /** Every filled card field, in card order: [{ label: "Category", value: "…" }]. */
  spec_rows: { label: string; value: string }[];
  skus: {
    index: number;
    name: string;
    qty: number | null;
    /** Signed storage links — they expire, so re-read on every sync. */
    image_links: string[];
  }[];
};

/** Labels that must never leave Workflow (contact details, money). */
const SENSITIVE_LABEL =
  /e-?mail|phone|mobile|contact|unit\s*price|price|cost|\$|invoice|payment/i;

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t !== "—" ? t : null;
};

export function orderCardExport(src: OrderCardSource): OrderCardExport {
  return {
    order_id: src.order.id,
    order_number: src.order.title,
    column_name: src.columnName,
    customer_name: text(src.customerName),
    owner: text(src.ownerName),
    designer: text(src.designerName),
    priority: text(src.priority),
    tag: text(src.tagName),
    due_date:
      typeof src.order.due_date === "string" && src.order.due_date
        ? src.order.due_date.slice(0, 10)
        : null,
    due_date_display: text(src.dueDateFormatted),
    production_date: text(src.productionDateFormatted),
    application_enabled: src.applicationEnabled,
    total_qty: src.totalQty,
    // productFromOrder() returns the placeholder "order" when the card has no Product field.
    product: src.product?.trim().toLowerCase() === "order" ? null : text(src.product),
    die: text(src.die),
    artwork_link: text(src.artworkLink),
    design_task: text(src.designTask),
    spec_rows: src.specRows
      .filter((r) => r.label && r.value && !SENSITIVE_LABEL.test(r.label))
      .map((r) => ({ label: r.label, value: r.value })),
    skus: src.skuRows.map((s) => ({
      index: s.index,
      name: s.name,
      qty: s.qty,
      image_links: s.imageLinks.filter((u) => /^https?:\/\//i.test(u)),
    })),
  };
}
