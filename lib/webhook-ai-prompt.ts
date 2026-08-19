/**
 * Builds a copy-paste AI prompt for CRM → Workflow webhook mapping.
 * Regenerated from live tenant custom-field options + Integrations config.
 */

import { WEBHOOK_FALLBACK_SELECT_OPTIONS } from "@/lib/webhook-field-options";
import type { WebhookSourceStyles } from "@/lib/webhook-source-styles";

export interface WebhookFieldOptionSet {
  /** Webhook JSON key → accepted select values (tenant options or fallbacks). */
  optionsByKey: Record<string, string[]>;
}

const SELECT_KEYS_FOR_PROMPT = [
  "product_category",
  "product",
  "materials",
  "sides",
  "color_mode",
  "lamination",
  "finishing",
  "roll_direction",
  "position",
  "special_effects",
] as const;

function formatOptionList(values: string[]): string {
  if (values.length === 0) return "(no options configured — send exact CRM labels)";
  return values.map((v) => `- ${v}`).join("\n");
}

function resolveOptions(
  key: string,
  tenantOptions: Record<string, string[]>
): string[] {
  const fromTenant = tenantOptions[key];
  if (fromTenant && fromTenant.length > 0) return fromTenant;
  return WEBHOOK_FALLBACK_SELECT_OPTIONS[key] ?? [];
}

/**
 * Build tenant option map from custom_fields rows.
 * Matches webhook keys via common field names (Product, Materials, …).
 */
export function buildWebhookFieldOptionsFromCustomFields(
  fields: { name: string; options: unknown }[]
): Record<string, string[]> {
  const nameToKey: Record<string, string> = {
    product: "product",
    category: "product_category",
    "product category": "product_category",
    materials: "materials",
    sides: "sides",
    color: "color_mode",
    "color mode": "color_mode",
    lamination: "lamination",
    finishing: "finishing",
    "roll direction": "roll_direction",
    position: "position",
    "special effects": "special_effects",
  };

  const out: Record<string, string[]> = {};
  for (const field of fields) {
    const key = nameToKey[field.name.trim().toLowerCase()];
    if (!key) continue;
    if (!Array.isArray(field.options) || field.options.length === 0) continue;
    const opts = field.options
      .map((o) => {
        if (typeof o === "string") return o.trim();
        if (o && typeof o === "object" && "value" in o) {
          const v = (o as { value: unknown }).value;
          return typeof v === "string" ? v.trim() : "";
        }
        return "";
      })
      .filter(Boolean);
    if (opts.length > 0) out[key] = opts;
  }
  return out;
}

export function buildWebhookAiPrompt(opts: {
  webhookUrl: string;
  tenantFieldOptions?: Record<string, string[]>;
  sourceStyles?: WebhookSourceStyles | null;
  excludedProducts?: string[];
}): string {
  const tenant = opts.tenantFieldOptions ?? {};
  const sourceKeys = (opts.sourceStyles?.sources ?? [])
    .map((s) => s.key.trim())
    .filter(Boolean);
  const sourceHint =
    sourceKeys.length > 0
      ? sourceKeys.map((k) => `"${k}"`).join(", ")
      : `"crm"`;

  const excluded = (opts.excludedProducts ?? []).filter(Boolean);
  const productOptions = resolveOptions("product", tenant).filter(
    (p) => !excluded.includes(p)
  );

  const sections = SELECT_KEYS_FOR_PROMPT.map((key) => {
    const values =
      key === "product" ? productOptions : resolveOptions(key, tenant);
    const label = key;
    return `### \`${label}\`\n${formatOptionList(values)}`;
  }).join("\n\n");

  return `You are mapping another system's order data into ONE JSON body for the BazaarPrinting Workflow webhook.

Your job: given an order from the source system, output a single POST body that Workflow can ingest. Do not invent missing required identity fields. Do not wrap the JSON in markdown. Do not add extra top-level keys.

================================================================================
ENDPOINT
================================================================================
POST ${opts.webhookUrl}
Content-Type: application/json
x-webhook-secret: <secret from Workflow Settings → Integrations → Webhook>

Body = the JSON object below. No { "data": ... } wrapper.

================================================================================
HOW WORKFLOW TURNS THE PAYLOAD INTO CARDS
================================================================================
- One webhook POST = one CRM order.
- Each entry in items[] becomes ONE board card.
- One line item → still send items: [ { ... } ] (do not flatten unless you must).
- Multi-item cards are titled like ORD-2026-0486-1, ORD-2026-0486-2.
- Re-sending the same order_number updates the existing cards (due date / rush). Do not create duplicates.

================================================================================
HARD RULES
================================================================================
1. Map source dropdowns to the ACCEPTED VALUES lists below. Prefer exact matches. Fuzzy match is OK for minor typos; never invent a new product name.
2. Empty selects: omit the field or send "". Never send "None", "None (inactive)", "N/A", or "-".
3. Booleans: send true/false. For rush only, also accepted: 1, "true", "yes", "rush".
4. Dates: YYYY-MM-DD. due_date should be today or a future date when set.
5. Money: numbers preferred (deposit, balance, unit_price). "$100" is OK.
6. design_task = http(s) URL only (Google Drive / job folder). Non-URL notes go in description or notes.
7. title is the human job name shown after the source label (CRM | …). NEVER put order_number in title. Omit title rather than repeating the order number.
8. CRM order_number for source "crm" must look like ORD-YYYY-#### (example: ORD-2026-0486).

================================================================================
ALWAYS SEND WHEN THE SOURCE SYSTEM HAS THE VALUE
================================================================================
Order level:
- source: one of ${sourceHint}
- customer_name
- customer_contact (email)
- customer_phone
- order_number
- title (human title — not the order number)
- priority: normal | high | low | urgent
- rush: true | false
    true → amber attention triangle on the card
    aliases: is_rush, rush_order, rush_status
    does NOT change priority — a rush job can stay priority "normal"
- is_key_account: true | false  → gold star on the card
- due_date (YYYY-MM-DD) when known
- due_date_mode: "fixed" | "after_approval"
- due_processing_days: number of Mon–Fri days when after_approval
- due_date_label: human text e.g. "5 working days after approval"
- due_date_status: "set" | "pending_approval" | "none"
- due_anchor_at: ISO timestamp when the calendar due was materialized
- description (customer-facing order description)
- notes (internal / attention notes on every sub-card; alias internal_note)
- production_notes (floor / job ticket notes)
- category (board TAG name if it matches a tag)
- product_category (Category dropdown; prefer this over category)
- source_url (CRM order page URL — needed for the billing globe Source link)
- payment_status: partial | full  (paid / complete also map to full)
- deposit
- balance
- request_owner_email / request_owner_name / request_owner_phone (or owner_*)
- designer_email or designer (name)
- designer_information

Each items[] line:
- title (short line name, e.g. "Roll Labels")
- rush (optional per line; inherits order-level rush if omitted)
- category / product_category
- product, materials
- finished_size  OR width + height (Workflow builds "W x H in")
- sides, color_mode, roll_direction, lamination / finishing, die
- special_effects: string or string[]
- unit_price, quantity
- spot_uv, foil, die_cut, application, need_a_design, perforation (booleans)
- order_qty (else SKU quantities are summed)
- artwork_url (public URL)
- description / notes / production_notes / line_item_comment
- skus: [{ sku_name, quantity, artwork_url, comment }]

================================================================================
RUSH / ATTENTION ICON
================================================================================
Send "rush": true when the source order is a rush job.
That is what puts the attention triangle on the Workflow card.
Do not use priority=high as a substitute unless the job is actually high priority.

================================================================================
BILLING GLOBE
================================================================================
If source_url, payment_status, deposit, and balance are all missing, Workflow shows NO globe.
Always include at least one of them when known.

================================================================================
DUE DATES
================================================================================
- Known calendar due → due_date: "YYYY-MM-DD", due_date_mode: "fixed", due_date_status: "set"
- Due after approval (no calendar date yet) → omit/empty due_date, due_date_mode: "after_approval", due_processing_days: N, due_date_status: "pending_approval", due_date_label: "N working days after approval"
- When the source later materializes the date, re-POST the same order_number with the new due_date.

================================================================================
ACCEPTED SELECT VALUES (keep these in sync with Workflow Settings → Fields)
================================================================================

${sections}

================================================================================
OUTPUT
================================================================================
Return ONLY the JSON body. No markdown fences. No commentary.

TEMPLATE — fill from the source order; drop keys you do not have:
{
  "source": "crm",
  "customer_name": "",
  "customer_contact": "",
  "customer_phone": "",
  "order_number": "",
  "title": "",
  "priority": "normal",
  "rush": false,
  "is_key_account": false,
  "due_date": "YYYY-MM-DD",
  "due_date_mode": "fixed",
  "due_date_status": "set",
  "description": "",
  "notes": "",
  "production_notes": "",
  "category": "",
  "product_category": "",
  "source_url": "",
  "payment_status": "partial",
  "deposit": 0,
  "balance": 0,
  "request_owner_email": "",
  "request_owner_name": "",
  "request_owner_phone": "",
  "designer_email": "",
  "designer_information": "",
  "items": [
    {
      "title": "",
      "category": "",
      "product_category": "",
      "product": "",
      "width": 0,
      "height": 0,
      "finished_size": "",
      "materials": "",
      "sides": "",
      "color_mode": "",
      "roll_direction": "",
      "lamination": "",
      "special_effects": [],
      "unit_price": 0,
      "quantity": 0,
      "spot_uv": false,
      "foil": false,
      "die_cut": false,
      "application": false,
      "need_a_design": false,
      "perforation": false,
      "rush": false,
      "order_qty": 0,
      "artwork_url": "",
      "description": "",
      "notes": "",
      "production_notes": "",
      "skus": [
        { "sku_name": "", "quantity": 0, "artwork_url": "", "comment": "" }
      ]
    }
  ]
}
`;
}
