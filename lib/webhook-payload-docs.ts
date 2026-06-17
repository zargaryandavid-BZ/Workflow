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

/** Copy-paste webhook integration guide shown in Settings → Integrations. */
export function buildWebhookPayloadDocs(
  webhookUrl: string,
  secretKey: string
): string {
  const year = new Date().getFullYear();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const due = dueDate.toISOString().slice(0, 10);

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

## Quick Example

\`\`\`json
{
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",
  "customer_phone": "+1 310 555 0100",
  "order_number": "ORD-${year}-001",
  "title": "Acme Corp — Mixed Print Order",
  "priority": "normal",
  "due_date": "${due}",
  "items": [
    {
      "title": "Roll Labels",
      "product": "Vinyl Labels / 54'' Rolls",
      "product_type": "Roll",
      "finished_size": "4 x 3 in",
      "materials": "White BOPP",
      "finishing": "Spot UV",
      "sides": "1 Side",
      "color": "CMYK",
      "order_qty": 3000,
      "skus": [
        { "sku_name": "Flavor A", "quantity": 1000 },
        { "sku_name": "Flavor B", "quantity": 1000 },
        { "sku_name": "Flavor C", "quantity": 1000 }
      ]
    },
    {
      "title": "Business Cards",
      "product": "Business Cards",
      "product_type": "Flat",
      "finished_size": "3.5 x 2 in",
      "materials": "16pt C2S",
      "finishing": "Spot UV",
      "sides": "2 Sides",
      "color": "CMYK",
      "order_qty": 500,
      "skus": [
        { "sku_name": "Standard", "quantity": 500 }
      ]
    }
  ]
}
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
| \`customer_contact\` | ✅* | string | Email (*required if no phone) |
| \`customer_phone\` | ✅* | string | Phone (*required if no email) |
| \`order_number\` | ✅ | string | Your reference e.g. \`"ORD-${year}-001"\` — stored as the card order number |
| \`title\` | No | string | Order title — auto-generated if omitted |
| \`priority\` | No | string | \`normal\` · \`high\` · \`low\` · \`urgent\` (default: normal) |
| \`due_date\` | ✅ | string | \`"YYYY-MM-DD"\` — must be today or a future date |
| \`description\` | No | string | Order-level notes visible on all cards |
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
| \`order_qty\` | No | number | Auto-calculated from SKUs when omitted |
| \`artwork_url\` | No | string | Public URL — stored as external artwork asset |
| \`description\` | No | string | Item-level notes |
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
  "order_number": "ORD-${year}-001"
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

---

## Notes

- If \`materials\`, \`finishing\`, \`product\`, \`product_type\`, \`sides\`, or \`color\` don't match dropdown options, the field may be **blank** on the card — the order is still created.
- \`customer_contact\` and \`customer_phone\` — at least one valid email or phone is required. Existing customers are reused (no duplicate).
- SKUs are stored on \`orders.specs.skus\`; artwork URLs create \`assets\` rows with \`external_url\`.
- **Not set via webhook:** Designer assignment, Artwork GDrive link custom field — staff fill these in the app.
- Cards land in the first board column. Copy Order Link appears after the card is moved out of that column.`;
}
