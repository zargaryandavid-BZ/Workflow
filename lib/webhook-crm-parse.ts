/** CRM order webhook parse helpers (no app aliases — safe for node:test). */

export function parseWebhookNumericQty(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Print / item quantity for Order QTY.
 * Uses `order_qty` or `quantity`. Does **not** use `sku_qty` (SKU row count).
 * Falls back to the sum of SKU row quantities only when print qty is omitted.
 */
export function webhookPrintQty(
  spec: {
    order_qty?: unknown;
    quantity?: unknown;
    sku_qty?: unknown;
  },
  skus: { qty?: number | null }[]
): number | null {
  const explicit =
    parseWebhookNumericQty(spec.order_qty) ??
    parseWebhookNumericQty(spec.quantity);
  if (explicit != null) return explicit;
  const sum = skus.reduce(
    (acc, s) =>
      acc + (typeof s.qty === "number" && !Number.isNaN(s.qty) ? s.qty : 0),
    0
  );
  return sum > 0 ? sum : null;
}

function pickTrimmedNote(
  ...vals: (string | null | undefined)[]
): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type CrmLabeledNotes = {
  client: string | null;
  designer: string | null;
  production: string | null;
  /** Text that is not a For Customer / For Designer / For Prod section. */
  remainder: string | null;
};

const LABELED_HEADER_RE =
  /^(For Customer|For Designer|For Production|For Prod)\s*:/i;

/**
 * CRM used to mash ticket columns into one `notes` string:
 * `For Prod:\nPICK PREVIOUS JOB…`. Split those labels so Workflow can put
 * For Prod on Production notes, For Designer on Designer note, etc.
 */
export function parseCrmLabeledNotes(
  raw: string | null | undefined
): CrmLabeledNotes {
  const empty: CrmLabeledNotes = {
    client: null,
    designer: null,
    production: null,
    remainder: null,
  };
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return empty;
  if (!LABELED_HEADER_RE.test(text.split(/\r?\n/, 1)[0] ?? "") &&
      !/\nFor (Customer|Designer|Production|Prod)\s*:/i.test(text)) {
    return { ...empty, remainder: text };
  }

  const sections: { label: string; body: string }[] = [];
  let remainderParts: string[] = [];
  let current: { label: string; parts: string[] } | null = null;

  for (const line of text.split(/\r?\n/)) {
    const header = line.trim().match(LABELED_HEADER_RE);
    if (header) {
      if (current) {
        sections.push({
          label: current.label,
          body: current.parts.join("\n").trim(),
        });
      }
      const rest = line.replace(LABELED_HEADER_RE, "").trim();
      current = { label: header[1]!.toLowerCase(), parts: rest ? [rest] : [] };
      continue;
    }
    if (current) current.parts.push(line);
    else if (line.trim()) remainderParts.push(line);
  }
  if (current) {
    sections.push({
      label: current.label,
      body: current.parts.join("\n").trim(),
    });
  }

  const take = (aliases: string[]) => {
    const bodies = sections
      .filter((s) => aliases.includes(s.label))
      .map((s) => s.body)
      .filter(Boolean);
    return bodies.length ? bodies.join("\n\n") : null;
  };

  const remainder = remainderParts.join("\n").trim();
  return {
    client: take(["for customer"]),
    designer: take(["for designer"]),
    production: take(["for prod", "for production"]),
    remainder: remainder || null,
  };
}

function labeledFromTicketNotes(order: {
  notes?: string | null;
  internal_note?: string | null;
}): CrmLabeledNotes {
  return parseCrmLabeledNotes(
    pickTrimmedNote(order.internal_note, order.notes)
  );
}

/** CRM ticket Attention / Internal Notes — unlabeled leftover only. */
export function crmTicketStaffNote(order: {
  notes?: string | null;
  internal_note?: string | null;
}): string | null {
  const labeled = labeledFromTicketNotes(order);
  if (labeled.client || labeled.designer || labeled.production) {
    return labeled.remainder;
  }
  return pickTrimmedNote(order.internal_note, order.notes);
}

/** CRM "For Customer" → card Customer note (`specs.customer_facing_note`). */
export function crmCustomerFacingNote(
  order: {
    description?: string | null;
    notes?: string | null;
    internal_note?: string | null;
  },
  item?: { description?: string | null }
): string | null {
  return pickTrimmedNote(
    item?.description,
    order.description,
    labeledFromTicketNotes(order).client
  );
}

/** CRM "For Designer" → card Designer note (`specs.designer_notes`). */
export function crmDesignerNote(input: {
  designer_information?: string | null;
  designer_notes?: string | null;
  notes_for_designer?: string | null;
  notes?: string | null;
  internal_note?: string | null;
}): string | null {
  return pickTrimmedNote(
    input.designer_information,
    input.designer_notes,
    input.notes_for_designer,
    labeledFromTicketNotes(input).designer
  );
}

export function crmOrderIdFromPayload(body: {
  crm_order_id?: string | null;
}): string | null {
  return pickTrimmedNote(body.crm_order_id);
}

export function crmCustomerIdFromPayload(body: {
  crm_customer_id?: string | null;
  customer?: { crm_id?: string | null } | null;
}): string | null {
  return pickTrimmedNote(
    body.crm_customer_id,
    body.customer?.crm_id
  );
}

/**
 * Production notes for one line. `line_item_comment` only.
 * Item `notes` / `description` are empty from CRM and must not be used.
 */
export function crmLineProductionNote(item: {
  production_notes?: string | null;
  notes_for_production?: string | null;
  line_item_comment?: string | null;
  line_comment?: string | null;
  comment?: string | null;
  notes?: string | null;
  description?: string | null;
}): string | null {
  return pickTrimmedNote(
    item.production_notes,
    item.notes_for_production,
    item.line_item_comment,
    item.line_comment,
    item.comment,
    parseCrmLabeledNotes(item.notes).production
  );
}

/** Order-level For Prod (dedicated fields, then labeled `notes` blob). */
export function crmOrderProductionNote(order: {
  production_notes?: string | null;
  notes_for_production?: string | null;
  line_item_comment?: string | null;
  notes?: string | null;
  internal_note?: string | null;
}): string | null {
  return pickTrimmedNote(
    order.production_notes,
    order.notes_for_production,
    order.line_item_comment,
    labeledFromTicketNotes(order).production
  );
}

/** Append size/color breakdown when CRM sends `order_qty_details`. */
export function withOrderQtyDetails(
  production: string | null,
  orderQtyDetails?: string | null
): string | null {
  const details =
    typeof orderQtyDetails === "string" ? orderQtyDetails.trim() : "";
  if (!details) return production;
  if (production && production.includes(details)) return production;
  return [production, details].filter(Boolean).join("\n\n");
}
