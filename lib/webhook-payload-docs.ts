import { PRODUCTS } from "@/lib/product-data";
import { WEBHOOK_FALLBACK_SELECT_OPTIONS } from "@/lib/webhook-field-options";

const MATERIALS_DOC_GROUPS: { title: string; items: string[] }[] = [
  {
    title: "Pouches / Cosmetic Web",
    items: [
      "Pouch Double sided",
      "Pouche One sided",
      "Clear Cosmetic Web",
      "White Cosmetic Web",
      "Silver Cosmetic Web",
    ],
  },
  {
    title: "Jar / Tube combos",
    items: [
      "Plastic & Side & Top",
      "Plastic & Side",
      "Plastic & Top",
      "Plastic",
      "Glass & Side & Top",
      "Glass & Side",
      "Glass",
    ],
  },
  {
    title: "BOPP",
    items: ["Clear BOPP", "White BOPP", "Silver BOPP", "Holo BOPP"],
  },
  {
    title: "Label Sheets",
    items: ["Gloss Label Sheet", "Matte Label Sheet", "Semi Gloss"],
  },
  {
    title: "Cardstock (16th Street)",
    items: [
      "14pt C1S",
      "14pt C2S",
      "16pt C1S",
      "16pt C2S",
      "18pt C1S",
      "18pt C2S",
      "18pt Silver",
      "24pt C1S",
      "24pt C2S",
    ],
  },
  {
    title: "Cardstock / Sheet (Boyd Street)",
    items: ["16pt (Boyd)", "18pt (Boyd)", "20pt (Boyd)", "24pt (Boyd)"],
  },
  {
    title: "Cover / Text",
    items: [
      "80lb Cover",
      "100lb Cover",
      "110lb Cover",
      "80lb Text",
      "100lb Text",
    ],
  },
  {
    title: "Vinyl",
    items: [
      "White Vinyl",
      "White Vinyl - Aggressive Glue",
      "Holographic Vinyl",
    ],
  },
  {
    title: "Specialty / Large Format",
    items: [
      "Banner Material",
      "Window Decal",
      "Self-Adhesive (Peel-and-Stick)",
      "Traditional / Unpasted",
    ],
  },
  {
    title: "Apparel",
    items: [
      "Sweatshirt",
      "Hoodie",
      "Polo",
      "Tee",
      "Activewear",
      "Hat",
      "Bikini",
      "Short",
      "Jogger",
    ],
  },
];

function optionsBlock(options: readonly string[]): string {
  return options.join("\n");
}

function webhookDocDates() {
  const year = new Date().getFullYear();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  return { year, due: dueDate.toISOString().slice(0, 10) };
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function materialsMarkdown(): string {
  return MATERIALS_DOC_GROUPS.map(
    (g) => `**${g.title}**\n\`\`\`\n${optionsBlock(g.items)}\n\`\`\``
  ).join("\n\n");
}

function materialsHtml(): string {
  return MATERIALS_DOC_GROUPS.map(
    (g) =>
      `<h4>${escHtml(g.title)}</h4><ul class="options">${g.items
        .map((o) => `<li><code>${escHtml(o)}</code></li>`)
        .join("")}</ul>`
  ).join("");
}

function fullSingleItemExample(year: number, due: string): string {
  return `{
  "source": "crm",
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",
  "customer_phone": "+1 310 555 0100",
  "order_number": "ORD-${year}-013-3",
  "title": "Acme Corp — Roll Labels Order",
  "priority": "normal",
  "due_date": "${due}",
  "description": "Rush if possible — ship to LA warehouse.",
  "request_owner_email": "am@example.com",
  "request_owner_name": "Sarah Kim",
  "request_owner_phone": "+1 310 555 0199",
  "designer_email": "artist@example.com",
  "designer_information": "Use brand colors from style guide. Leave 0.125 in bleed.",
  "category": "Labels",
  "product": "Labels (Roll)",
  "finished_size": "4 x 3 in",
  "materials": "White BOPP",
  "sides": "1 Side",
  "color_mode": "CMYK",
  "roll_direction": "1-Top",
  "lamination": "Matte",
  "spot_uv": false,
  "foil": false,
  "die_cut": false,
  "application": false,
  "need_a_design": false,
  "perforation": false,
  "order_qty": 3000,
  "artwork_url": "https://example.com/artwork/order-level-proof.pdf",
  "skus": [
    { "sku_name": "Flavor A", "quantity": 1000, "artwork_url": "https://example.com/artwork/flavor-a.png" },
    { "sku_name": "Flavor B", "quantity": 1000, "artwork_url": "https://example.com/artwork/flavor-b.png" },
    { "sku_name": "Flavor C", "quantity": 1000, "artwork_url": "https://example.com/artwork/flavor-c.png" }
  ]
}`;
}

function fullMultiItemExample(year: number, due: string): string {
  return `{
  "source": "crm",
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",
  "customer_phone": "+1 310 555 0100",
  "order_number": "ORD-${year}-013-3",
  "title": "Acme Corp — Mixed Print Order",
  "priority": "high",
  "due_date": "${due}",
  "description": "Order-level notes visible on all cards.",
  "request_owner_email": "am@example.com",
  "request_owner_name": "Sarah Kim",
  "designer_email": "artist@example.com",
  "designer_information": "Match prior batch colors.",
  "category": "Mixed",
  "items": [
    {
      "title": "Roll Labels",
      "category": "Labels",
      "product": "Labels (Roll)",
      "finished_size": "4 x 3 in",
      "materials": "White BOPP",
      "sides": "1 Side",
      "color_mode": "CMYK",
      "roll_direction": "1-Top",
      "lamination": "Matte",
      "spot_uv": false,
      "foil": false,
      "die_cut": false,
      "application": false,
      "need_a_design": false,
      "perforation": false,
      "order_qty": 3000,
      "artwork_url": "https://example.com/artwork/labels-master.pdf",
      "description": "Item-level notes for labels only.",
      "skus": [
        { "sku_name": "Flavor A", "quantity": 1000, "artwork_url": "https://example.com/artwork/flavor-a.png" },
        { "sku_name": "Flavor B", "quantity": 1000, "artwork_url": "https://example.com/artwork/flavor-b.png" },
        { "sku_name": "Flavor C", "quantity": 1000, "artwork_url": "https://example.com/artwork/flavor-c.png" }
      ]
    },
    {
      "title": "Business Cards",
      "category": "Cards",
      "product": "Business Cards",
      "finished_size": "3.5 x 2 in",
      "materials": "16pt C2S",
      "sides": "2 Sides",
      "color_mode": "CMYK",
      "lamination": "Gloss",
      "spot_uv": true,
      "foil": false,
      "die_cut": false,
      "application": false,
      "need_a_design": false,
      "perforation": false,
      "order_qty": 500,
      "artwork_url": "https://example.com/artwork/business-cards.pdf",
      "skus": [
        { "sku_name": "Standard", "quantity": 500, "artwork_url": "https://example.com/artwork/biz-card.png" }
      ]
    }
  ]
}`;
}

const ITEM_FIELDS_MD = `
| Field | Required | Type | Notes |
|---|---|---|---|
| \`title\` | No | string | Item label — card shows suffixed order number |
| \`product\` | No | string | Must match tenant **Product** dropdown (see below) |
| \`finished_size\` | No | string | Free text e.g. \`"3.5 x 2 in"\` |
| \`materials\` | No | string | Must match tenant **Materials** dropdown |
| \`sides\` | No | string | \`1 Side\` or \`2 Sides\` |
| \`color_mode\` | No | string | \`CMYK\` · \`CMYK+White\` · \`Pantones\` (also accepts \`color\`) |
| \`roll_direction\` | No | string | \`1-Top\` · \`2-Bottom\` · \`3-Right\` · \`4-Left\` (also accepts \`position\`) |
| \`lamination\` | No | string | Must match tenant **Lamination** dropdown |
| \`spot_uv\` | No | boolean | \`true\` / \`false\` |
| \`foil\` | No | boolean | \`true\` / \`false\` |
| \`die_cut\` | No | boolean | \`true\` / \`false\` |
| \`application\` | No | boolean | \`true\` / \`false\` |
| \`need_a_design\` | No | boolean | \`true\` / \`false\` |
| \`perforation\` | No | boolean | \`true\` / \`false\` |
| \`order_qty\` | No | number | Auto-calculated from SKUs when omitted |
| \`artwork_url\` | No | string | Public URL — stored as external artwork asset |
| \`description\` | No | string | Item-level notes |
| \`designer_information\` | No | string | Designer notes for this item |
| \`designer_email\` | No | string | Overrides order-level assigned designer |
| \`designer_id\` | No | string | Overrides order-level assigned designer |
| \`designer\` | No | string | Overrides order-level assigned designer |
| \`request_owner_email\` | No | string | Overrides order-level request owner |
| \`request_owner_name\` | No | string | Overrides order-level request owner name |
| \`request_owner_contact\` | No | string | Overrides order-level request owner contact |
| \`request_owner_phone\` | No | string | Overrides order-level request owner phone |
| \`category\` | No | string | Tag name for this item (also accepts \`category_name\`) |
| \`skus\` | No | array | Omit for 0 SKU variations |`;

const NOTES_MD = `
- **All payload fields are optional.** Send only what you have — the order is still created with blank fields where data is omitted.
- If \`order_number\` is omitted, the system auto-generates one (e.g. \`WH-20260619143022-a1b2c3d4\`).
- \`color\` is accepted as an alias for \`color_mode\`. \`position\` is accepted as an alias for \`roll_direction\`.
- The legacy \`finishing\` field (e.g. \`"Spot UV"\`, \`"Foil Gold"\`) is still accepted and maps to the **Finishing** custom field when present. Prefer explicit boolean fields (\`spot_uv\`, \`foil\`, etc.) for new integrations.
- \`customer_contact\` and \`customer_phone\` are optional. When **both** are sent, the order's **Customer Contact** field stores the **phone**; the linked **customer** record stores both email and phone. Existing customers are reused — no duplicates.
- SKUs are stored on \`orders.specs.skus\`; artwork URLs create \`assets\` rows with \`external_url\`.
- **Owner** (\`owner_*\` / \`request_owner_*\`) must be an **account manager** on your team to set the Owner dropdown. Free-text \`request_owner_name\`, \`request_owner_contact\`, and \`request_owner_phone\` are always saved on the card when provided.
- \`designer_information\` / \`designer_notes\` fill the **Designer Information** custom field only.
- \`design_task\` must be an **http(s) URL** for Design files; non-URL text goes into Order Description.
- Per-SKU \`description\` / \`comment\` values become Order Description lines: \`SKU1: …\`, \`SKU2: …\`.
- \`designer_information\` is saved as designer notes on the card and in the **Designer Information** custom field.
- **Not set via webhook:** Artwork GDrive link — staff fill this in the app.
- Cards land in the first board column. Copy Order Link appears after the card is moved out of that column.
- **⚠️ Rotate the webhook secret before going to production.** Settings → Integrations → Webhook → Regenerate.`;

/** Copy-paste webhook integration guide shown in Settings → Integrations. */
export function buildWebhookPayloadDocs(
  webhookUrl: string,
  secretKey: string
): string {
  const { year, due } = webhookDocDates();
  const sides = WEBHOOK_FALLBACK_SELECT_OPTIONS.sides ?? [];
  const colorMode = WEBHOOK_FALLBACK_SELECT_OPTIONS.color_mode ?? [];
  const rollDirection = WEBHOOK_FALLBACK_SELECT_OPTIONS.position ?? [];
  const lamination = WEBHOOK_FALLBACK_SELECT_OPTIONS.lamination ?? [];

  return `# Webhook Payload Reference — BazaarPrinting Workflow

**Endpoint:** \`POST ${webhookUrl}\`
**Header:** \`x-webhook-secret: ${secretKey}\`
**Content-Type:** \`application/json\`

---

## Quick Example — Single order (all parameters)

\`\`\`json
${fullSingleItemExample(year, due)}
\`\`\`

## Quick Example — Multi-item order

\`\`\`json
${fullMultiItemExample(year, due)}
\`\`\`

---

## All Supported Configurations

| Config | Lines | SKUs per line | Cards created |
|---|---|---|---|
| 1 | 1 line | 0 SKUs | \`ORD-001\` |
| 2 | 1 line | 1 SKU | \`ORD-001\` |
| 3 | 1 line | Multiple SKUs | \`ORD-001\` |
| 4 | Multiple lines | All 0 SKUs | \`ORD-001-1\`, \`ORD-001-2\`... |
| 5 | Multiple lines | All 1 SKU each | \`ORD-001-1\`, \`ORD-001-2\`... |
| 6 | Multiple lines | All multiple SKUs each | \`ORD-001-1\`, \`ORD-001-2\`... |
| 7 | Multiple lines | Mixed (0 / 1 / many) | \`ORD-001-1\`, \`ORD-001-2\`... |
| 8 | Legacy flat (no \`items[]\`) | Any | \`ORD-001\` (no suffix) |

Multi-item orders suffix each card: \`ORD-001-1\`, \`ORD-001-2\`. Single-item / legacy keeps the plain number.

---

## Order-Level Fields

| Field | Required | Type | Notes |
|---|---|---|---|
| \`customer_name\` | No | string | Customer display name |
| \`customer_contact\` | No | string | Email — saved on the customer record |
| \`customer_phone\` | No | string | Phone — when both are sent, phone is stored as the order's primary Customer Contact |
| \`source\` | No | string | Integration source key (e.g. \`"crm"\`). Matched in **Settings → Integrations → Source labels** for the colored label above the customer name. Unknown/missing uses the Other style. Manual cards have no label. |
| \`order_number\` | No | string | Your reference e.g. \`"ORD-${year}-001"\` — auto-generated (\`WH-…\`) if omitted |
| \`title\` | No | string | Order title — auto-generated if omitted |
| \`priority\` | No | string | \`normal\` · \`high\` · \`low\` · \`urgent\` (default: normal) |
| \`due_date\` | No | string | \`"YYYY-MM-DD"\` — must be today or a future date when provided |
| \`description\` | No | string | Order-level notes visible on all cards |
| \`owner_email\` | No | string | Account manager email — sets **Owner** on the card |
| \`owner_id\` | No | string | Account manager UUID — same as \`owner_email\` |
| \`owner\` | No | string | Account manager email, UUID, or display name |
| \`request_owner_email\` | No | string | Alias for \`owner_email\` |
| \`request_owner_id\` | No | string | Alias for \`owner_id\` |
| \`request_owner\` | No | string | Alias for \`owner\` |
| \`request_owner_name\` | No | string | Free-text request owner name (saved on card) |
| \`request_owner_contact\` | No | string | Free-text request owner email or contact (saved on card) |
| \`request_owner_phone\` | No | string | Free-text request owner phone (saved on card) |
| \`designer_email\` | No | string | Team member email — sets **Assigned Designer** |
| \`designer_id\` | No | string | Team member UUID — sets **Assigned Designer** |
| \`designer\` | No | string | Email, UUID, or display name — sets **Assigned Designer** |
| \`designer_information\` | No | string | Designer Information custom field (also \`designer_notes\`) |
| \`design_task\` | No | string | http(s) URL → Design files; non-URL → Order Description |
| \`category\` | No | string | Tag name (also accepts \`category_name\`) |
| \`source_url\` | No | string | CRM / source order URL — card globe popover **Source** link (aliases: \`source_link\`, \`order_url\`) |
| \`payment_status\` | No | string | \`partial\` or \`full\` (also \`paid\` / \`complete\` → full). Alias: \`payment\` |
| \`deposit\` | No | number \\| string | Deposit amount stored in \`specs.billing\` |
| \`balance\` | No | number \\| string | Remaining balance stored in \`specs.billing\` |
| \`items\` | No | array | Omit for legacy single-item flat format |

---

## Per-Item Fields (inside \`items[]\`)
${ITEM_FIELDS_MD}

Legacy flat format: put these fields at the top level instead of inside \`items[]\`.

---

## Per-SKU Fields (inside \`skus[]\`)

| Field | Required | Type | Notes |
|---|---|---|---|
| \`sku_name\` | No | string | Variant display name |
| \`quantity\` | No | number | Number of pieces |
| \`artwork_url\` | No | string | Per-SKU artwork URL |
| \`description\` | No | string | Line comment → Order Description as \`SKU1: …\` (alias: \`comment\`) |

---

## Accepted Field Values

⚠️ Dropdown values must match your tenant's **Settings → Fields** options. The webhook **fuzzy-matches** case/spacing and minor typos, but exact matches are safest.

### \`priority\`
\`\`\`
normal
high
low
urgent
\`\`\`

### \`payment_status\`
\`\`\`
partial
full
\`\`\`
Also accepted: \`paid\`, \`complete\` (mapped to \`full\`). Alias field: \`payment\`.

Billing fields (\`source_url\`, \`payment_status\`, \`deposit\`, \`balance\`) are stored on the order as \`specs.billing\` and shown via a globe icon next to the priority chip on the board card. If none are sent, no globe is shown.

### \`product\`
\`\`\`
${optionsBlock(PRODUCTS)}
\`\`\`

### \`materials\`

${materialsMarkdown()}

### \`sides\`
\`\`\`
${optionsBlock(sides)}
\`\`\`

### \`color_mode\`
\`\`\`
${optionsBlock(colorMode)}
\`\`\`

### \`roll_direction\`
\`\`\`
${optionsBlock(rollDirection)}
\`\`\`

### \`lamination\`
\`\`\`
${optionsBlock(lamination)}
\`\`\`

### Boolean fields
\`spot_uv\`, \`foil\`, \`die_cut\`, \`application\`, \`need_a_design\`, \`perforation\` — send \`true\` or \`false\`. Omitting is treated as \`false\`.

---

## Response Format

### Multi-item (\`items[]\` present)
\`\`\`json
{
  "success": true,
  "order_number": "ORD-${year}-001",
  "owner_id": "uuid",
  "owner_name": "Jane Doe",
  "jobs": [
    { "order_id": "uuid-1", "item_index": 0, "title": "Roll Labels" },
    { "order_id": "uuid-2", "item_index": 1, "title": "Business Cards" }
  ]
}
\`\`\`

### Single-item (legacy flat format)
\`\`\`json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-${year}-001",
  "owner_id": "uuid",
  "owner_name": "Jane Doe"
}
\`\`\`

Optional \`warning\` string when artwork or custom fields partially fail to save, or when dropdown values were auto-corrected via fuzzy matching.

---

## Error Responses

| Status | Example \`error\` | Cause |
|---|---|---|
| 401 | \`Unauthorized\` | Wrong or missing \`x-webhook-secret\` |
| 403 | \`Webhook is disabled\` | Webhook toggled off in Settings |
| 400 | \`Invalid JSON\` | Malformed request body |
| 422 | \`Due date cannot be in the past.\` | Past \`due_date\` when provided |
| 422 | \`items[N] is invalid\` | Malformed entry in \`items[]\` |
| 500 | \`Server error\` | Server-side failure |

Invalid or unknown optional values (owner, designer, dropdown fields) do **not** fail the request — the order is still created and the field is left blank. Check the \`warning\` field in the response.

---

## Notes
${NOTES_MD}`;
}

function optionsListHtml(label: string, options: readonly string[]): string {
  const items = options
    .map((o) => `<li><code>${escHtml(o)}</code></li>`)
    .join("");
  return `<h3><code>${escHtml(label)}</code></h3><ul class="options">${items}</ul>`;
}

function fieldTableHtml(
  rows: [string, string, string, string][]
): string {
  const body = rows
    .map(
      ([field, required, type, notes]) =>
        `<tr><td><code>${escHtml(field)}</code></td><td>${required}</td><td>${escHtml(type)}</td><td>${notes}</td></tr>`
    )
    .join("");
  return `<table>
    <thead><tr><th>Field</th><th>Required</th><th>Type</th><th>Notes</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/** Styled HTML integration guide — standalone document for copy / download. */
export function buildWebhookPayloadDocsHtml(
  webhookUrl: string,
  secretKey: string
): string {
  const { year, due } = webhookDocDates();
  const sides = WEBHOOK_FALLBACK_SELECT_OPTIONS.sides ?? [];
  const colorMode = WEBHOOK_FALLBACK_SELECT_OPTIONS.color_mode ?? [];
  const rollDirection = WEBHOOK_FALLBACK_SELECT_OPTIONS.position ?? [];
  const lamination = WEBHOOK_FALLBACK_SELECT_OPTIONS.lamination ?? [];

  const orderFields: [string, string, string, string][] = [
    ["customer_name", "No", "string", "Customer display name"],
    ["customer_contact", "No", "string", "Email — saved on the customer record"],
    [
      "customer_phone",
      "No",
      "string",
      "Phone — when both are sent, phone is the order primary Customer Contact",
    ],
    [
      "source",
      "No",
      "string",
      'Integration source key (e.g. <code>"crm"</code>). Matched in Settings → Integrations → Source labels for the colored card label. Unknown/missing uses Other style.',
    ],
    [
      "order_number",
      "No",
      "string",
      `Your reference e.g. <code>ORD-${year}-001</code> — auto-generated (<code>WH-…</code>) if omitted`,
    ],
    ["title", "No", "string", "Order title — auto-generated if omitted"],
    [
      "priority",
      "No",
      "string",
      "<code>normal</code> · <code>high</code> · <code>low</code> · <code>urgent</code> (default: normal)",
    ],
    [
      "due_date",
      "No",
      "string",
      '<code>"YYYY-MM-DD"</code> — must be today or a future date when provided',
    ],
    ["description", "No", "string", "Order-level notes visible on all cards"],
    [
      "source_url",
      "No",
      "string",
      "CRM / source order URL — shown as Source on the card globe popover (aliases: <code>source_link</code>, <code>order_url</code>). Stored in <code>specs.billing</code>.",
    ],
    [
      "payment_status",
      "No",
      "string",
      "<code>partial</code> or <code>full</code> (also <code>paid</code> / <code>complete</code> → full). Alias: <code>payment</code>.",
    ],
    ["deposit", "No", "number | string", "Deposit amount (e.g. <code>100</code> or <code>$100</code>)"],
    ["balance", "No", "number | string", "Remaining balance"],
    [
      "owner_email",
      "No",
      "string",
      "Account manager email — sets <strong>Owner</strong> on the card",
    ],
    ["owner_id", "No", "string", "Account manager UUID"],
    ["owner", "No", "string", "Account manager email, UUID, or display name"],
    ["request_owner_email", "No", "string", "Alias for <code>owner_email</code>"],
    ["request_owner_id", "No", "string", "Alias for <code>owner_id</code>"],
    ["request_owner", "No", "string", "Alias for <code>owner</code>"],
    [
      "request_owner_name",
      "No",
      "string",
      "Free-text request owner name (saved on card)",
    ],
    [
      "request_owner_contact",
      "No",
      "string",
      "Free-text request owner email or contact",
    ],
    ["request_owner_phone", "No", "string", "Free-text request owner phone"],
    [
      "designer_email",
      "No",
      "string",
      "Team member email — sets <strong>Assigned Designer</strong>",
    ],
    [
      "designer_id",
      "No",
      "string",
      "Team member UUID — sets <strong>Assigned Designer</strong>",
    ],
    [
      "designer",
      "No",
      "string",
      "Email, UUID, or display name — sets <strong>Assigned Designer</strong>",
    ],
    [
      "designer_information",
      "No",
      "string",
      "Designer Information custom field (also <code>designer_notes</code>)",
    ],
    [
      "design_task",
      "No",
      "string",
      "http(s) URL → Design files; non-URL → Order Description",
    ],
    [
      "category",
      "No",
      "string",
      "Tag name (also accepts <code>category_name</code>)",
    ],
    ["items", "No", "array", "Omit for legacy single-item flat format"],
  ];

  const itemFields: [string, string, string, string][] = [
    ["title", "No", "string", "Item label — card shows suffixed order number"],
    [
      "product",
      "No",
      "string",
      "Must match tenant <strong>Product</strong> dropdown (see below)",
    ],
    ["finished_size", "No", "string", 'Free text e.g. <code>"3.5 x 2 in"</code>'],
    [
      "materials",
      "No",
      "string",
      "Must match tenant <strong>Materials</strong> dropdown",
    ],
    ["sides", "No", "string", "<code>1 Side</code> or <code>2 Sides</code>"],
    [
      "color_mode",
      "No",
      "string",
      "<code>CMYK</code> · <code>CMYK+White</code> · <code>Pantones</code> (also accepts <code>color</code>)",
    ],
    [
      "roll_direction",
      "No",
      "string",
      "<code>1-Top</code> · <code>2-Bottom</code> · <code>3-Right</code> · <code>4-Left</code> (also accepts <code>position</code>)",
    ],
    [
      "lamination",
      "No",
      "string",
      "Must match tenant <strong>Lamination</strong> dropdown",
    ],
    ["spot_uv", "No", "boolean", "<code>true</code> / <code>false</code>"],
    ["foil", "No", "boolean", "<code>true</code> / <code>false</code>"],
    ["die_cut", "No", "boolean", "<code>true</code> / <code>false</code>"],
    ["application", "No", "boolean", "<code>true</code> / <code>false</code>"],
    ["need_a_design", "No", "boolean", "<code>true</code> / <code>false</code>"],
    ["perforation", "No", "boolean", "<code>true</code> / <code>false</code>"],
    ["order_qty", "No", "number", "Auto-calculated from SKUs when omitted"],
    [
      "artwork_url",
      "No",
      "string",
      "Public URL — stored as external artwork asset",
    ],
    ["description", "No", "string", "Item-level notes"],
    ["designer_information", "No", "string", "Designer notes for this item"],
    [
      "designer_email",
      "No",
      "string",
      "Overrides order-level assigned designer",
    ],
    ["designer_id", "No", "string", "Overrides order-level assigned designer"],
    ["designer", "No", "string", "Overrides order-level assigned designer"],
    [
      "request_owner_email",
      "No",
      "string",
      "Overrides order-level request owner",
    ],
    [
      "request_owner_name",
      "No",
      "string",
      "Overrides order-level request owner name",
    ],
    [
      "request_owner_contact",
      "No",
      "string",
      "Overrides order-level request owner contact",
    ],
    [
      "request_owner_phone",
      "No",
      "string",
      "Overrides order-level request owner phone",
    ],
    [
      "category",
      "No",
      "string",
      "Tag name (also accepts <code>category_name</code>)",
    ],
    ["skus", "No", "array", "Omit for 0 SKU variations"],
  ];

  const skuFields: [string, string, string, string][] = [
    ["sku_name", "No", "string", "Variant display name"],
    ["quantity", "No", "number", "Number of pieces"],
    ["artwork_url", "No", "string", "Per-SKU artwork URL"],
    [
      "description",
      "No",
      "string",
      "Line comment → Order Description as <code>SKU1: …</code> (alias: <code>comment</code>)",
    ],
  ];

  const configRows = [
    ["1", "1 line", "0 SKUs", "<code>ORD-001</code>"],
    ["2", "1 line", "1 SKU", "<code>ORD-001</code>"],
    ["3", "1 line", "Multiple SKUs", "<code>ORD-001</code>"],
    ["4", "Multiple lines", "All 0 SKUs", "<code>ORD-001-1</code>, <code>ORD-001-2</code>…"],
    ["5", "Multiple lines", "All 1 SKU each", "<code>ORD-001-1</code>, <code>ORD-001-2</code>…"],
    ["6", "Multiple lines", "All multiple SKUs each", "<code>ORD-001-1</code>, <code>ORD-001-2</code>…"],
    ["7", "Multiple lines", "Mixed (0 / 1 / many)", "<code>ORD-001-1</code>, <code>ORD-001-2</code>…"],
    ["8", "Legacy flat (no <code>items[]</code>)", "Any", "<code>ORD-001</code> (no suffix)"],
  ];

  const errorRows = [
    ["401", "<code>Unauthorized</code>", "Wrong or missing <code>x-webhook-secret</code>"],
    ["403", "<code>Webhook is disabled</code>", "Webhook toggled off in Settings"],
    ["400", "<code>Invalid JSON</code>", "Malformed request body"],
    ["422", "<code>Due date cannot be in the past.</code>", "Past <code>due_date</code> when provided"],
    ["422", "<code>items[N] is invalid</code>", "Malformed entry in <code>items[]</code>"],
    ["500", "<code>Server error</code>", "Server-side failure"],
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Webhook Payload Reference — BazaarPrinting Workflow</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #0f172a;
      --muted: #64748b;
      --border: #e2e8f0;
      --accent: #1e293b;
      --code-bg: #0f172a;
      --code-text: #e2e8f0;
      --warn: #b45309;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    h1 { font-size: 1.75rem; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
    h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; padding-top: 0.25rem; border-top: 1px solid var(--border); }
    h2:first-of-type { border-top: 0; margin-top: 1.5rem; }
    h3 { font-size: 0.95rem; margin: 1.25rem 0 0.5rem; color: var(--accent); }
    h4 { font-size: 0.88rem; margin: 1rem 0 0.35rem; color: var(--muted); font-weight: 600; }
    p, li { color: var(--text); }
    .lede { color: var(--muted); margin: 0 0 1.5rem; }
    .meta {
      display: grid;
      gap: 0.75rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      margin-bottom: 1.5rem;
    }
    .meta div { font-size: 0.92rem; }
    .meta strong { color: var(--accent); }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.88em;
      background: #f1f5f9;
      padding: 0.1em 0.35em;
      border-radius: 4px;
    }
    pre {
      margin: 0.75rem 0 0;
      padding: 1rem 1.1rem;
      background: var(--code-bg);
      color: var(--code-text);
      border-radius: 10px;
      overflow: auto;
      font-size: 0.78rem;
      line-height: 1.5;
    }
    pre code { background: transparent; padding: 0; color: inherit; font-size: inherit; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin: 0.75rem 0;
    }
    th, td {
      text-align: left;
      padding: 0.55rem 0.75rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { background: #f8fafc; font-weight: 600; color: var(--accent); }
    tr:last-child td { border-bottom: 0; }
    .warn { color: var(--warn); font-weight: 600; }
    ul { margin: 0.4rem 0 0.75rem; padding-left: 1.25rem; }
    ul.options { columns: 2; column-gap: 1.5rem; }
    ul.options li { break-inside: avoid; margin-bottom: 0.2rem; }
    .notes li { margin-bottom: 0.35rem; color: var(--muted); }
    .section { margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Webhook Payload Reference</h1>
    <p class="lede">BazaarPrinting Workflow — inbound order creation via <code>POST</code></p>

    <div class="meta">
      <div><strong>Endpoint:</strong> <code>POST ${escHtml(webhookUrl)}</code></div>
      <div><strong>Header:</strong> <code>x-webhook-secret: ${escHtml(secretKey)}</code></div>
      <div><strong>Content-Type:</strong> <code>application/json</code></div>
    </div>

    <h2>Quick example — single order (all parameters)</h2>
    <pre><code>${escHtml(fullSingleItemExample(year, due))}</code></pre>

    <h2>Quick example — multi-item order</h2>
    <pre><code>${escHtml(fullMultiItemExample(year, due))}</code></pre>

    <h2>All supported configurations</h2>
    <table>
      <thead><tr><th>Config</th><th>Lines</th><th>SKUs per line</th><th>Cards created</th></tr></thead>
      <tbody>
        ${configRows.map(([c, l, s, cards]) => `<tr><td>${c}</td><td>${l}</td><td>${s}</td><td>${cards}</td></tr>`).join("")}
      </tbody>
    </table>
    <p>Multi-item orders suffix each card. Single-item / legacy keeps the plain number.</p>

    <h2>Order-level fields</h2>
    ${fieldTableHtml(orderFields)}

    <h2>Per-item fields (inside <code>items[]</code>)</h2>
    ${fieldTableHtml(itemFields)}
    <p>Legacy flat format: put these fields at the top level instead of inside <code>items[]</code>.</p>

    <h2>Per-SKU fields (inside <code>skus[]</code>)</h2>
    ${fieldTableHtml(skuFields)}

    <h2>Accepted field values</h2>
    <p class="warn">⚠️ Dropdown values must match your tenant's Settings → Fields options. The webhook fuzzy-matches case/spacing and minor typos, but exact matches are safest.</p>
    <h3><code>priority</code></h3>
    <ul class="options"><li><code>normal</code></li><li><code>high</code></li><li><code>low</code></li><li><code>urgent</code></li></ul>
    ${optionsListHtml("product", PRODUCTS)}
    <h3><code>materials</code></h3>
    ${materialsHtml()}
    ${optionsListHtml("sides", sides)}
    ${optionsListHtml("color_mode", colorMode)}
    ${optionsListHtml("roll_direction", rollDirection)}
    ${optionsListHtml("lamination", lamination)}
    <h3>Boolean fields</h3>
    <p><code>spot_uv</code>, <code>foil</code>, <code>die_cut</code>, <code>application</code>, <code>need_a_design</code>, <code>perforation</code> — send <code>true</code> or <code>false</code>. Omitting is treated as <code>false</code>.</p>

    <h2>Response format</h2>
    <h3>Multi-item (<code>items[]</code> present)</h3>
    <pre><code>{
  "success": true,
  "order_number": "ORD-${year}-001",
  "owner_id": "uuid",
  "owner_name": "Jane Doe",
  "jobs": [
    { "order_id": "uuid-1", "item_index": 0, "title": "Roll Labels" },
    { "order_id": "uuid-2", "item_index": 1, "title": "Business Cards" }
  ]
}</code></pre>
    <h3>Single-item (legacy flat format)</h3>
    <pre><code>{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-${year}-001",
  "owner_id": "uuid",
  "owner_name": "Jane Doe"
}</code></pre>
    <p>Optional <code>warning</code> string when artwork or custom fields partially fail to save, or when dropdown values were auto-corrected via fuzzy matching.</p>

    <h2>Error responses</h2>
    <table>
      <thead><tr><th>Status</th><th>Example <code>error</code></th><th>Cause</th></tr></thead>
      <tbody>
        ${errorRows.map(([status, err, cause]) => `<tr><td>${status}</td><td>${err}</td><td>${cause}</td></tr>`).join("")}
      </tbody>
    </table>
    <p>Invalid or unknown optional values (owner, designer, dropdown fields) do <strong>not</strong> fail the request — the order is still created and the field is left blank. Check the <code>warning</code> field in the response.</p>

    <h2>Notes</h2>
    <ul class="notes">
      <li><strong>All payload fields are optional.</strong> Send only what you have — the order is still created with blank fields where data is omitted.</li>
      <li>If <code>order_number</code> is omitted, the system auto-generates one (e.g. <code>WH-20260619143022-a1b2c3d4</code>).</li>
      <li><code>color</code> is an alias for <code>color_mode</code>. <code>position</code> is an alias for <code>roll_direction</code>.</li>
      <li>The legacy <code>finishing</code> field is still accepted and maps to the <strong>Finishing</strong> custom field when present. Prefer explicit boolean fields for new integrations.</li>
      <li>When both <code>customer_contact</code> and <code>customer_phone</code> are sent, the order <strong>Customer Contact</strong> field stores the phone; the linked <strong>customer</strong> record stores both email and phone.</li>
      <li>SKUs are stored on <code>orders.specs.skus</code>; artwork URLs create <code>assets</code> rows with <code>external_url</code>.</li>
      <li><strong>Owner</strong> (<code>owner_*</code> / <code>request_owner_*</code>) must be an <strong>account manager</strong> to set the Owner dropdown. Free-text request owner fields are saved on the card when provided.</li>
      <li><code>designer_information</code> fills the <strong>Designer Information</strong> custom field only.</li>
      <li><code>design_task</code> must be an http(s) URL for <strong>Design files</strong>; non-URL text goes into Order Description.</li>
      <li>Per-SKU <code>description</code> / <code>comment</code> values become Order Description lines: <code>SKU1: …</code>, <code>SKU2: …</code>.</li>
      <li><strong>Not set via webhook:</strong> Artwork GDrive link — staff fill this in the app.</li>
      <li>Cards land in the first board column. Copy Order Link appears after the card is moved out of that column.</li>
      <li><strong>⚠️ Rotate the webhook secret before going to production.</strong> Settings → Integrations → Webhook → Regenerate.</li>
    </ul>
  </div>
</body>
</html>`;
}
