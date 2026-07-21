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

  return `You build JSON payloads for the BazaarPrinting Workflow webhook.

GOAL
When an order is created/updated in our CRM, send ONE POST body that includes
EVERY available field so Workflow cards show: source label, title, product specs,
quantity/price, designer/owner, notes, and the financial globe (payment info).

ENDPOINT
POST ${opts.webhookUrl}
Header: Content-Type: application/json
Header: x-webhook-secret: <secret from Settings → Integrations>
Body: JSON only. No extra wrapper keys.

RULES
1. Prefer \`items[]\` when the order has one or more line items (each line → one board card).
2. Always send order-level identity + billing + title when available.
3. Map CRM dropdown values to the ACCEPTED VALUES lists below. Prefer exact matches.
4. Never send "None", "None (inactive)", "N/A", or "-" for empty selects — omit the field or send "".
5. Booleans must be true/false, not "yes"/"no".
6. Dates must be YYYY-MM-DD and today or future.
7. Money: numbers preferred (deposit/balance/unit_price). Strings like "$100" are OK.
8. \`design_task\` = http(s) URL only (Drive/job folder). Non-URL notes go in \`description\` or \`notes\`.
9. Line comments / SKU comments → per-SKU \`comment\` (or \`description\`) so they land in Notes.
10. If only one line exists, still use \`items: [ {...} ]\` for consistency.

REQUIRED WHEN AVAILABLE (do not drop these)
Order level:
- source: one of ${sourceHint} (or a configured Integrations source key)
- customer_name
- customer_contact (email)
- customer_phone
- order_number
- title (human title shown as: Source | <title>)  ← NEVER put order_number here
- priority: normal|high|low|urgent
- due_date
- description (order description)
- notes (staff notes / Notes tab; alias internal_note)
- category
- source_url (CRM order page URL)  ← required for globe Source link
- payment_status: partial|full     ← required for payment globe
- deposit
- balance
- request_owner_email / request_owner_name / request_owner_phone (or owner_*)
- designer_email or designer (name)
- designer_information

Each items[] entry:
- title (line title)
- category
- product
- materials
- finished_size  OR width + height (Workflow builds "W x H" if finished_size omitted)
- sides, color_mode, roll_direction, lamination / finishing
- special_effects: string or string[]
- unit_price, quantity
- spot_uv, foil, die_cut, application, need_a_design, perforation (booleans)
- order_qty (if known; else SKU quantities are summed)
- artwork_url (public URL)
- description / notes
- skus: [{ sku_name, quantity, artwork_url, comment }]

FINANCIAL GLOBE
If payment fields are missing, Workflow shows NO globe.
Always include at least one of: source_url, payment_status, deposit, balance.

TITLE
- Order \`title\` = CRM order title / job name
- Do NOT use order_number as title
- Item \`title\` = line product short name

ACCEPTED SELECT VALUES (tenant configuration — keep these in sync)

${sections}

OUTPUT
Return ONLY valid JSON for the webhook body (no markdown, no commentary).

TEMPLATE (fill from CRM order data)
{
  "source": "crm",
  "customer_name": "",
  "customer_contact": "",
  "customer_phone": "",
  "order_number": "",
  "title": "",
  "priority": "normal",
  "due_date": "YYYY-MM-DD",
  "description": "",
  "notes": "",
  "category": "",
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
      "order_qty": 0,
      "artwork_url": "",
      "description": "",
      "notes": "",
      "skus": [
        { "sku_name": "", "quantity": 0, "artwork_url": "", "comment": "" }
      ]
    }
  ]
}
`;
}
