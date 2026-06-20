import { DEFAULT_PRINT_FIELDS } from "@/lib/print-field-defaults";

function fieldOptions(name: string): string[] {
  const field = DEFAULT_PRINT_FIELDS.find(
    (f) => f.name.toLowerCase() === name.toLowerCase()
  );
  return field?.options ?? [];
}

function optionsBlock(options: string[]): string {
  return options.map((o) => o).join("\n");
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

function fullSingleItemExample(year: number, due: string): string {
  return `{
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
  "product": "Vinyl Labels / 54'' Rolls",
  "product_type": "Roll",
  "finished_size": "4 x 3 in",
  "materials": "White BOPP",
  "finishing": "Spot UV",
  "sides": "1 Side",
  "roll_direction": "1-Top",
  "color": "CMYK",
  "order_qty": 3000,
  "artwork_url": "https://example.com/artwork/order-level-proof.pdf",
  "skus": [
    {
      "sku_name": "Flavor A",
      "quantity": 1000,
      "artwork_url": "https://example.com/artwork/flavor-a.png"
    },
    {
      "sku_name": "Flavor B",
      "quantity": 1000,
      "artwork_url": "https://example.com/artwork/flavor-b.png"
    },
    {
      "sku_name": "Flavor C",
      "quantity": 1000,
      "artwork_url": "https://example.com/artwork/flavor-c.png"
    }
  ]
}`;
}

function fullMultiItemExample(year: number, due: string): string {
  return `{
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
      "product": "Vinyl Labels / 54'' Rolls",
      "product_type": "Roll",
      "finished_size": "4 x 3 in",
      "materials": "White BOPP",
      "finishing": "Spot UV",
      "sides": "1 Side",
      "roll_direction": "1-Top",
      "color": "CMYK",
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
      "product_type": "Flat",
      "finished_size": "3.5 x 2 in",
      "materials": "16pt C2S",
      "finishing": "Foil Gold",
      "sides": "2 Sides",
      "color": "CMYK",
      "order_qty": 500,
      "artwork_url": "https://example.com/artwork/business-cards.pdf",
      "skus": [
        { "sku_name": "Standard", "quantity": 500, "artwork_url": "https://example.com/artwork/biz-card.png" }
      ]
    }
  ]
}`;
}

/** Copy-paste webhook integration guide shown in Settings → Integrations. */
export function buildWebhookPayloadDocs(
  webhookUrl: string,
  secretKey: string
): string {
  const { year, due } = webhookDocDates();

  const products = fieldOptions("Product");
  const productTypes = fieldOptions("Product Type");
  const materials = fieldOptions("Materials");
  const finishing = fieldOptions("Finishing");
  const sides = fieldOptions("Sides");
  const colors = fieldOptions("Color");
  const positions = fieldOptions("Position");

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
| \`customer_name\` | ✅ | string | Customer display name |
| \`customer_contact\` | ✅* | string | Email (*required if no phone). When both contact fields are sent, email is saved on the customer record. |
| \`customer_phone\` | ✅* | string | Phone (*required if no email). When both are sent, phone is the order's primary Customer Contact and is also saved on the customer record. |
| \`order_number\` | ✅ | string | Your reference e.g. \`"ORD-${year}-001"\` — stored as the card order number |
| \`title\` | No | string | Order title — auto-generated if omitted |
| \`priority\` | No | string | \`normal\` · \`high\` · \`low\` · \`urgent\` (default: normal) |
| \`due_date\` | ✅ | string | \`"YYYY-MM-DD"\` — must be today or a future date |
| \`description\` | No | string | Order-level notes visible on all cards |
| \`owner_email\` | No | string | Account manager email — sets **Owner** on the card (\`created_by\`) |
| \`owner_id\` | No | string | Account manager UUID — same as \`owner_email\` |
| \`owner\` | No | string | Account manager email, UUID, or display name |
| \`request_owner_email\` | No | string | Alias for \`owner_email\` — request submitter / account manager |
| \`request_owner_id\` | No | string | Alias for \`owner_id\` |
| \`request_owner\` | No | string | Alias for \`owner\` |
| \`request_owner_name\` | No | string | Free-text request owner name (saved on card) |
| \`request_owner_contact\` | No | string | Free-text request owner email or contact (saved on card) |
| \`request_owner_phone\` | No | string | Free-text request owner phone (saved on card) |
| \`designer_email\` | No | string | Team member email — sets **Assigned Designer** |
| \`designer_id\` | No | string | Team member UUID — sets **Assigned Designer** |
| \`designer\` | No | string | Email, UUID, or display name — sets **Assigned Designer** |
| \`designer_information\` | No | string | Designer notes (also \`designer_notes\`, \`design_task\`) |
| \`category\` | No | string | Category name (also accepts \`category_name\`) |
| \`items\` | No | array | Omit for legacy single-item flat format |

---

## Per-Item Fields (inside \`items[]\`)

| Field | Required | Type | Notes |
|---|---|---|---|
| \`title\` | No | string | Item label in response — card shows suffixed order number |
| \`product\` | No | string | Must match tenant dropdown (see below) |
| \`product_type\` | No | string | Must match tenant dropdown |
| \`finished_size\` | No | string | Free text e.g. \`"3.5 x 2 in"\` |
| \`materials\` | No | string | Must match tenant dropdown |
| \`finishing\` | No | string | Must match tenant dropdown |
| \`sides\` | No | string | Must match tenant dropdown |
| \`color\` | No | string | Must match tenant dropdown |
| \`position\` | No | string | Roll direction — also accepts \`roll_direction\` |
| \`roll_direction\` | No | string | Alias for \`position\` (e.g. \`1-Top\`) |
| \`order_qty\` | No | number | Auto-calculated from SKUs when omitted |
| \`artwork_url\` | No | string | Public URL — stored as external artwork asset |
| \`description\` | No | string | Item-level notes |
| \`request_owner_email\` | No | string | Overrides order-level request owner |
| \`request_owner_name\` | No | string | Overrides order-level request owner name |
| \`request_owner_contact\` | No | string | Overrides order-level request owner contact |
| \`request_owner_phone\` | No | string | Overrides order-level request owner phone |
| \`designer_email\` | No | string | Overrides order-level assigned designer |
| \`designer_id\` | No | string | Overrides order-level assigned designer |
| \`designer\` | No | string | Overrides order-level assigned designer |
| \`designer_information\` | No | string | Designer notes for this item |
| \`category\` | No | string | Category name (also accepts \`category_name\`) |
| \`skus\` | No | array | Omit for 0 SKU variations |

Legacy flat format: put these fields at the top level instead of inside \`items[]\`.

---

## Per-SKU Fields (inside \`skus[]\`)

| Field | Required | Type | Notes |
|---|---|---|---|
| \`sku_name\` | ✅ | string | Variant display name |
| \`quantity\` | ✅ | number | Number of pieces (min 1 when SKU row is sent) |
| \`artwork_url\` | No | string | Per-SKU artwork URL |

---

## Accepted Field Values

⚠️ Dropdown values must match your tenant's **Settings → Fields** options. The webhook fuzzy-matches case/spacing, but exact matches are safest. Defaults below:

### \`priority\`
\`\`\`
normal
high
low
urgent
\`\`\`

### \`product\`
\`\`\`
${optionsBlock(products)}
\`\`\`

### \`product_type\`
\`\`\`
${optionsBlock(productTypes)}
\`\`\`

### \`materials\`
\`\`\`
${optionsBlock(materials)}
\`\`\`

### \`finishing\`
\`\`\`
${optionsBlock(finishing)}
\`\`\`

### \`sides\`
\`\`\`
${optionsBlock(sides)}
\`\`\`

### \`color\`
\`\`\`
${optionsBlock(colors)}
\`\`\`

### \`position\` (optional label placement)
\`\`\`
${optionsBlock(positions)}
\`\`\`

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

Optional \`warning\` string when artwork or custom fields partially fail to save.

---

## Error Responses

| Status | Example \`error\` | Cause |
|---|---|---|
| 401 | \`Unauthorized\` | Wrong or missing \`x-webhook-secret\` |
| 403 | \`Webhook is disabled\` | Webhook toggled off in Settings |
| 400 | \`Invalid JSON\` | Malformed request body |
| 422 | \`Missing required field: customer_name\` | Required field absent |
| 422 | \`Missing required field: order_number\` | \`order_number\` absent |
| 422 | \`Missing required field: due_date\` | \`due_date\` absent |
| 422 | \`Due date cannot be in the past.\` | Past \`due_date\` |
| 422 | \`items array must not be empty\` | \`items: []\` sent |
| 500 | \`Server error\` | Server-side failure |

Invalid or unknown optional values (owner, designer, dropdown fields) do **not** fail the request — the order is still created and the field is left blank. Check the \`warning\` field in the response.

---

## Notes

- If \`materials\`, \`finishing\`, \`product\`, \`product_type\`, \`sides\`, \`color\`, or \`position\`/\`roll_direction\` don't match dropdown options, the field is **left blank** — the order is still created.
- \`customer_contact\` and \`customer_phone\` — at least one valid email or phone is required. When **both** are sent, the order's **Customer Contact** field stores the **phone**; the linked **customer** record stores **both email and phone**. Existing customers are reused (no duplicate).
- SKUs are stored on \`orders.specs.skus\`; artwork URLs create \`assets\` rows with \`external_url\`.
- **Owner** (\`owner_*\` / \`request_owner_*\`) must be an **account manager** on your team to set the Owner dropdown. Free-text \`request_owner_name\`, \`request_owner_contact\`, and \`request_owner_phone\` are always saved on the card when provided.
- \`designer_information\` is saved as designer notes on the card and in the **Designer Information** custom field when present.
- **Not set via webhook:** Artwork GDrive link custom field — staff can fill this in the app.
- Cards land in the first board column. Copy Order Link appears after the card is moved out of that column.`;
}

function optionsListHtml(label: string, options: string[]): string {
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
  const products = fieldOptions("Product");
  const productTypes = fieldOptions("Product Type");
  const materials = fieldOptions("Materials");
  const finishing = fieldOptions("Finishing");
  const sides = fieldOptions("Sides");
  const colors = fieldOptions("Color");
  const positions = fieldOptions("Position");

  const orderFields: [string, string, string, string][] = [
    ["customer_name", "✅", "string", "Customer display name"],
    ["customer_contact", "✅*", "string", "Email (*required if no phone). Saved on customer when both fields are sent."],
    ["customer_phone", "✅*", "string", "Phone (*required if no email). Order primary contact when both are sent; also saved on customer."],
    ["order_number", "✅", "string", `Your reference e.g. <code>ORD-${year}-001</code> — stored as the card order number`],
    ["title", "No", "string", "Order title — auto-generated if omitted"],
    ["priority", "No", "string", "<code>normal</code> · <code>high</code> · <code>low</code> · <code>urgent</code> (default: normal)"],
    ["due_date", "✅", "string", '<code>"YYYY-MM-DD"</code> — must be today or a future date'],
    ["description", "No", "string", "Order-level notes visible on all cards"],
    ["owner_email", "No", "string", "Account manager email — sets <strong>Owner</strong> (<code>created_by</code>)"],
    ["owner_id", "No", "string", "Account manager UUID"],
    ["owner", "No", "string", "Account manager email, UUID, or display name"],
    ["request_owner_email", "No", "string", "Alias for <code>owner_email</code>"],
    ["request_owner_id", "No", "string", "Alias for <code>owner_id</code>"],
    ["request_owner", "No", "string", "Alias for <code>owner</code>"],
    ["request_owner_name", "No", "string", "Free-text request owner name (saved on card)"],
    ["request_owner_contact", "No", "string", "Free-text request owner email or contact"],
    ["request_owner_phone", "No", "string", "Free-text request owner phone"],
    ["designer_email", "No", "string", "Team member email — sets <strong>Assigned Designer</strong>"],
    ["designer_id", "No", "string", "Team member UUID — sets <strong>Assigned Designer</strong>"],
    ["designer", "No", "string", "Email, UUID, or display name — sets <strong>Assigned Designer</strong>"],
    ["designer_information", "No", "string", "Designer notes (also <code>designer_notes</code>, <code>design_task</code>)"],
    ["category", "No", "string", "Category name (also accepts <code>category_name</code>)"],
    ["items", "No", "array", "Omit for legacy single-item flat format"],
  ];

  const itemFields: [string, string, string, string][] = [
    ["title", "No", "string", "Item label in response — card shows suffixed order number"],
    ["product", "No", "string", "Must match tenant dropdown (see below)"],
    ["product_type", "No", "string", "Must match tenant dropdown"],
    ["finished_size", "No", "string", 'Free text e.g. <code>"3.5 x 2 in"</code>'],
    ["materials", "No", "string", "Must match tenant dropdown"],
    ["finishing", "No", "string", "Must match tenant dropdown"],
    ["sides", "No", "string", "Must match tenant dropdown"],
    ["color", "No", "string", "Must match tenant dropdown"],
    ["position", "No", "string", "Roll direction — also accepts <code>roll_direction</code>"],
    ["roll_direction", "No", "string", "Alias for <code>position</code> (e.g. <code>1-Top</code>)"],
    ["order_qty", "No", "number", "Auto-calculated from SKUs when omitted"],
    ["artwork_url", "No", "string", "Public URL — stored as external artwork asset"],
    ["description", "No", "string", "Item-level notes"],
    ["request_owner_email", "No", "string", "Overrides order-level request owner"],
    ["request_owner_name", "No", "string", "Overrides order-level request owner name"],
    ["request_owner_contact", "No", "string", "Overrides order-level request owner contact"],
    ["request_owner_phone", "No", "string", "Overrides order-level request owner phone"],
    ["designer_email", "No", "string", "Overrides order-level assigned designer"],
    ["designer_information", "No", "string", "Designer notes for this item"],
    ["category", "No", "string", "Category name (also accepts <code>category_name</code>)"],
    ["skus", "No", "array", "Omit for 0 SKU variations"],
  ];

  const skuFields: [string, string, string, string][] = [
    ["sku_name", "✅", "string", "Variant display name"],
    ["quantity", "✅", "number", "Number of pieces (min 1 when SKU row is sent)"],
    ["artwork_url", "No", "string", "Per-SKU artwork URL"],
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
    ["422", "<code>Missing required field: customer_name</code>", "Required field absent"],
    ["422", "<code>Missing required field: order_number</code>", "<code>order_number</code> absent"],
    ["422", "<code>Missing required field: due_date</code>", "<code>due_date</code> absent"],
    ["422", "<code>Due date cannot be in the past.</code>", "Past <code>due_date</code>"],
    ["422", "<code>items array must not be empty</code>", "<code>items: []</code> sent"],
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

    <h2>Full example — single order (all parameters)</h2>
    <p class="section">Legacy flat format — creates one board card with every supported field.</p>
    <pre><code>${escHtml(fullSingleItemExample(year, due))}</code></pre>

    <h2>Full example — multi-item order</h2>
    <p class="section">Creates multiple cards: <code>ORD-${year}-013-3-1</code>, <code>ORD-${year}-013-3-2</code>, etc.</p>
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
    <p class="warn">⚠️ Dropdown values must match your tenant's Settings → Fields options. Exact matches are safest.</p>
    <h3><code>priority</code></h3>
    <ul class="options"><li><code>normal</code></li><li><code>high</code></li><li><code>low</code></li><li><code>urgent</code></li></ul>
    ${optionsListHtml("product", products)}
    ${optionsListHtml("product_type", productTypes)}
    ${optionsListHtml("materials", materials)}
    ${optionsListHtml("finishing", finishing)}
    ${optionsListHtml("sides", sides)}
    ${optionsListHtml("color", colors)}
    ${optionsListHtml("position", positions)}

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
    <p>Optional <code>warning</code> string when artwork or custom fields partially fail to save.</p>

    <h2>Error responses</h2>
    <table>
      <thead><tr><th>Status</th><th>Example <code>error</code></th><th>Cause</th></tr></thead>
      <tbody>
        ${errorRows.map(([status, err, cause]) => `<tr><td>${status}</td><td>${err}</td><td>${cause}</td></tr>`).join("")}
      </tbody>
    </table>
    <p>Invalid or unknown optional values (owner, designer, dropdown fields) do <strong>not</strong> fail the request. Check the <code>warning</code> field in the response.</p>

    <h2>Notes</h2>
    <ul class="notes">
      <li>If dropdown fields don't match options, the field is <strong>left blank</strong> — the order is still created.</li>
      <li><code>customer_contact</code> and <code>customer_phone</code> — at least one valid email or phone is required. When both are sent, the order <strong>Customer Contact</strong> field stores the phone; the linked <strong>customer</strong> record stores both email and phone.</li>
      <li>SKUs are stored on <code>orders.specs.skus</code>; artwork URLs create <code>assets</code> rows with <code>external_url</code>.</li>
      <li><strong>Owner</strong> (<code>owner_*</code> / <code>request_owner_*</code>) must be an <strong>account manager</strong> to set the Owner dropdown. Free-text request owner fields are saved on the card when provided.</li>
      <li><strong>Designer</strong> must match a workspace member with the Designer role. If not found, the order is still created — see <code>warning</code>.</li>
      <li><code>designer_information</code> is saved as designer notes and in the <strong>Designer Information</strong> custom field.</li>
      <li><strong>Not set via webhook:</strong> Artwork GDrive link — staff can fill this in the app.</li>
      <li>Cards land in the first board column.</li>
    </ul>
  </div>
</body>
</html>`;
}
