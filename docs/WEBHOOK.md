# Webhook Integration Guide — BazaarPrinting Workflow

Use this endpoint to **automatically create job cards** on the production board from any external application (order management system, e-commerce platform, Zapier, Make, custom script, etc.).

---

## Connection Details

| | |
|---|---|
| **Endpoint** | `POST https://workflow-rho-one.vercel.app/api/webhook/orders` |
| **Auth header** | `x-webhook-secret: <your-secret-key>` |
| **Content-Type** | `application/json` |

> **Find your secret key:** Settings → Integrations → Webhook  
> **Rotate it before going to production:** Settings → Integrations → Webhook → Regenerate

---

## Quick Start — Minimal Payload

```json
{
  "source": "crm",
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",
  "order_number": "ORD-2026-001",
  "product": "Labels (Roll)",
  "materials": "White BOPP",
  "order_qty": 3000
}
```

That's it. Every field is optional — the card is created with whatever you send.

Send a `source` key (e.g. `"crm"`) to match **Settings → Integrations → Source labels** for a colored label above the customer name on the board. Unknown or missing sources use the configured Other style. Cards created manually in the app never show a source label.

---

## Full Example — Single Order (all parameters)

```json
{
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",
  "customer_phone": "+1 310 555 0100",
  "order_number": "ORD-2026-013-3",
  "title": "Acme Corp — Roll Labels Order",
  "priority": "normal",
  "due_date": "2026-07-24",
  "description": "Rush if possible — ship to LA warehouse.",
  "category": "Labels",
  "request_owner_email": "am@yourcompany.com",
  "request_owner_name": "Sarah Kim",
  "request_owner_phone": "+1 310 555 0199",
  "designer_email": "artist@yourcompany.com",
  "designer_information": "Use brand colors from style guide. Leave 0.125 in bleed.",
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
  "artwork_url": "https://yourdomain.com/files/order-proof.pdf",
  "skus": [
    { "sku_name": "Flavor A", "quantity": 1000, "comment": "1 sku- 200 boxes- (matte finish)", "artwork_url": "https://yourdomain.com/files/flavor-a.png" },
    { "sku_name": "Flavor B", "quantity": 1000, "comment": "2 sided lb bag- (sample)", "artwork_url": "https://yourdomain.com/files/flavor-b.png" },
    { "sku_name": "Flavor C", "quantity": 1000, "artwork_url": "https://yourdomain.com/files/flavor-c.png" }
  ]
}
```

---

## Multi-Item Order (creates one card per item)

When you pass `items[]`, each item becomes a separate board card numbered `ORD-001-1`, `ORD-001-2`, etc.

```json
{
  "customer_name": "Acme Corp",
  "customer_contact": "hello@acme.com",
  "order_number": "ORD-2026-013-3",
  "title": "Acme Corp — Mixed Print Order",
  "priority": "high",
  "due_date": "2026-07-24",
  "description": "Order-level notes visible on all cards.",
  "request_owner_email": "am@yourcompany.com",
  "designer_email": "artist@yourcompany.com",
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
      "order_qty": 3000,
      "artwork_url": "https://yourdomain.com/files/labels-master.pdf",
      "skus": [
        { "sku_name": "Flavor A", "quantity": 1000 },
        { "sku_name": "Flavor B", "quantity": 2000 }
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
      "order_qty": 500,
      "artwork_url": "https://yourdomain.com/files/biz-cards.pdf"
    }
  ]
}
```

---

## All Supported Configurations

| Config | Lines | SKUs per line | Cards created |
|---|---|---|---|
| 1 | 1 line | 0 SKUs | `ORD-001` |
| 2 | 1 line | 1 SKU | `ORD-001` |
| 3 | 1 line | Multiple SKUs | `ORD-001` |
| 4 | Multiple lines, all 0 SKUs | — | `ORD-001-1`, `ORD-001-2`… |
| 5 | Multiple lines, all 1 SKU | — | `ORD-001-1`, `ORD-001-2`… |
| 6 | Multiple lines, multiple SKUs | — | `ORD-001-1`, `ORD-001-2`… |
| 7 | Multiple lines, mixed | — | `ORD-001-1`, `ORD-001-2`… |
| 8 | Legacy flat (no `items[]`) | Any | `ORD-001` (no suffix) |

---

## Order-Level Fields

| Field | Type | Notes |
|---|---|---|
| `customer_name` | string | Customer display name |
| `customer_contact` | string | Customer **email** — saved on the customer record |
| `customer_phone` | string | Customer **phone** — when both are sent, phone is the primary Customer Contact |
| `order_number` | string | Your reference e.g. `"ORD-2026-001"` — auto-generated if omitted |
| `title` | string | Label after source (`CRM \| …`) — **omit/empty for blank** (order # still shows) |
| `priority` | string | `normal` · `high` · `low` · `urgent` (default: `normal`) |
| `due_date` | string | `"YYYY-MM-DD"` — must be today or a future date |
| `description` | string | **Order Description** on the card |
| `notes` | string | **Notes** tab (alias: `internal_note`). Combined with SKU comments |
| `category` | string | Category name (also accepts `category_name`) |
| `source_url` | string | CRM / source order page URL — shown as **Source** on the card globe popover (aliases: `source_link`, `order_url`) |
| `payment_status` | string | `partial` or `full` (also `paid` / `complete` → full). Alias: `payment` |
| `deposit` | number \| string | Deposit amount (e.g. `100` or `"$100"`) — stored in `specs.billing` |
| `balance` | number \| string | Remaining balance — stored in `specs.billing` |
| `owner_email` | string | Account manager email — sets **Owner** on the card |
| `owner_id` | string | Account manager UUID |
| `owner` | string | Account manager email, UUID, or display name |
| `request_owner_email` | string | Alias for `owner_email` |
| `request_owner_id` | string | Alias for `owner_id` |
| `request_owner` | string | Alias for `owner` |
| `request_owner_name` | string | Free-text name (saved on card even if not a system user) |
| `request_owner_contact` | string | Free-text contact (saved on card) |
| `request_owner_phone` | string | Free-text phone (saved on card) |
| `designer_email` | string | Team member email — sets **Assigned Designer** |
| `designer_id` | string | Team member UUID — sets **Assigned Designer** |
| `designer` | string | Email, UUID, or display name — sets **Assigned Designer** |
| `designer_information` | string | Designer Information custom field (also `designer_notes`) — **not** Design files |
| `design_task` | string | **http(s) URL only** → Design files. Non-URL text is folded into Order Description |
| `items` | array | Omit for legacy single-item flat format |

---

## Per-Item Fields (inside `items[]`)

Each item object can override any order-level field. Fields not set on the item fall back to the order-level value.

| Field | Type | Notes |
|---|---|---|
| `title` | string | Item label — card shows suffixed order number |
| `category` | string | Category for this item (also `category_name`) |
| `product` | string | Must match **Product** dropdown — see values below |
| `finished_size` | string | Free text e.g. `"3.5 x 2 in"` (auto-built from `width` + `height` when omitted) |
| `width` | number \| string | Width — stored on **Width** custom field; also used to build Finished Size |
| `height` | number \| string | Height — stored on **Height** custom field; also used to build Finished Size |
| `materials` | string | Must match **Materials** dropdown — see values below |
| `sides` | string | `1 Side` or `2 Sides` |
| `color_mode` | string | `CMYK` · `CMYK+White` · `Pantones` (also accepts `color`) |
| `position` | string | Position custom field (when present) |
| `roll_direction` | string | `1-Top` · `2-Bottom` · `3-Right` · `4-Left` → **Roll Direction** |
| `lamination` | string | Must match **Lamination** / **Finishing** dropdown — see values below |
| `special_effects` | string \| string[] | e.g. `"1-pass raised UV"` or `["Gold Foil","Spot UV"]` → **Special effects** |
| `unit_price` | number \| string | Unit price → **Unit Price** / **Unit Price ($)** |
| `quantity` | number \| string | Line quantity → **Quantity** (falls back to SKU qty sum) |
| `spot_uv` | boolean | `true` / `false` |
| `foil` | boolean | `true` / `false` |
| `die_cut` | boolean | `true` / `false` |
| `application` | boolean | `true` / `false` |
| `need_a_design` | boolean | `true` / `false` |
| `perforation` | boolean | `true` / `false` |
| `order_qty` | number | Auto-calculated from SKU quantities when omitted |
| `artwork_url` | string | **Public URL** to the artwork file — stored as an external asset |
| `description` | string | Item-level **Order Description** |
| `notes` | string | Item-level **Notes** tab (alias: `internal_note`) |
| `designer_information` | string | Designer Information custom field for this item |
| `design_task` | string | http(s) URL → Design files; non-URL → Order Description |
| `designer_email` | string | Overrides order-level assigned designer |
| `designer_id` | string | Overrides order-level assigned designer |
| `designer` | string | Overrides order-level assigned designer |
| `request_owner_email` | string | Overrides order-level request owner |
| `request_owner_name` | string | Overrides order-level request owner name |
| `request_owner_contact` | string | Overrides order-level request owner contact |
| `request_owner_phone` | string | Overrides order-level request owner phone |
| `skus` | array | SKU variations — see below |

---

## Per-SKU Fields (inside `skus[]`)

| Field | Type | Notes |
|---|---|---|
| `sku_name` | string | Variant display name e.g. `"Flavor A"` |
| `quantity` | number | Number of pieces for this variant |
| `artwork_url` | string | Per-SKU artwork URL (overrides item-level `artwork_url` for this SKU) |
| `description` | string | Line comment → **Notes** tab as `SKU1: …` (alias: `comment`) |

---

## Accepted Field Values

> ⚠️ Dropdown values are **fuzzy-matched** (case and spacing insensitive) against your tenant's Settings → Fields options. Exact matches are safest. If a value can't be matched, the field is left blank and a `warning` is returned.

### `priority`
```
normal
high
low
urgent
```

### `product`
```
Pouches Combo
Jar Combo
Tube Combo
Labels (Roll)
Labels (Sheet)
Folding Cartons / Boxes
Business Cards
Flyers / Postcards
Booklets
Diecut Stickers
Vinyl Labels / 54'' Rolls
Vinyl Signage
Banners / Large Format
Window Decals
Wallpaper
Sheet Products (Boyd)
Apparel
Pouches Only
Tube Only
Jar Only
Other
```

### `materials`

**Pouches / Cosmetic Web**
```
Pouch Double sided
Pouche One sided
Clear Cosmetic Web
White Cosmetic Web
Silver Cosmetic Web
```

**Jar / Tube combos**
```
Plastic & Side & Top
Plastic & Side
Plastic & Top
Plastic
Glass & Side & Top
Glass & Side
Glass
```

**BOPP**
```
Clear BOPP
White BOPP
Silver BOPP
Holo BOPP
```

**Label Sheets**
```
Gloss Label Sheet
Matte Label Sheet
Semi Gloss
```

**Cardstock (16th Street)**
```
14pt C1S
14pt C2S
16pt C1S
16pt C2S
18pt C1S
18pt C2S
18pt Silver
24pt C1S
24pt C2S
```

**Cardstock / Sheet (Boyd Street)**
```
16pt (Boyd)
18pt (Boyd)
20pt (Boyd)
24pt (Boyd)
```

**Cover / Text**
```
80lb Cover
100lb Cover
110lb Cover
80lb Text
100lb Text
```

**Vinyl**
```
White Vinyl
White Vinyl - Aggressive Glue
Holographic Vinyl
```

**Specialty / Large Format**
```
Banner Material
Window Decal
Self-Adhesive (Peel-and-Stick)
Traditional / Unpasted
```

**Apparel**
```
Sweatshirt
Hoodie
Polo
Tee
Activewear
Hat
Bikini
Short
Jogger
```

### `sides`
```
1 Side
2 Sides
```

### `color_mode` (also accepts `color`)
```
CMYK
CMYK+White
Pantones
```

### `roll_direction` (also accepts `position`)
```
1-Top
2-Bottom
3-Right
4-Left
```

### `lamination`
```
None
Gloss
Matte
Soft Touch
Holo
Coating
```

### Boolean fields
`spot_uv`, `foil`, `die_cut`, `application`, `need_a_design`, `perforation` — send `true` or `false`. Omitting is treated as `false`.

---

## Response

### Single item (or legacy flat format)
```json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-2026-001",
  "owner_id": "uuid-or-null",
  "owner_name": "Sarah Kim"
}
```

### Multi-item (`items[]` present)
```json
{
  "success": true,
  "order_number": "ORD-2026-001",
  "owner_id": "uuid-or-null",
  "owner_name": "Sarah Kim",
  "jobs": [
    { "order_id": "uuid-1", "item_index": 0, "title": "Roll Labels" },
    { "order_id": "uuid-2", "item_index": 1, "title": "Business Cards" }
  ]
}
```

An optional `warning` string is included when:
- Dropdown values were auto-corrected via fuzzy matching
- Owner or designer lookup failed (field left blank, order still created)
- Artwork URL could not be saved

---

## Error Responses

| Status | `error` | Cause |
|---|---|---|
| `401` | `Unauthorized` | Missing or wrong `x-webhook-secret` |
| `403` | `Webhook is disabled` | Webhook toggled off in Settings |
| `400` | `Invalid JSON` | Malformed request body |
| `422` | `Due date cannot be in the past.` | Past `due_date` provided |
| `422` | `items[N] is invalid` | Malformed entry in `items[]` |
| `500` | `Server error` | Server-side failure |

> Invalid or unknown optional values (owner, designer, dropdowns) do **not** fail the request — the order is created and the field is left blank. Always check the `warning` field.

---

## Notes

- **All fields are optional.** Send only what you have.
- `order_number` is auto-generated (`WH-YYYYMMDDHHMMSS-xxxxxxxx`) if omitted.
- `color` is an alias for `color_mode`. `position` is an alias for `roll_direction`.
- The legacy `finishing` field (`"Spot UV"`, `"Foil Gold"`, etc.) is still accepted and maps to the **Finishing** custom field. Prefer explicit boolean fields for new integrations.
- When both `customer_contact` (email) and `customer_phone` are sent, the order's **Customer Contact** field stores the phone. The linked customer record stores both. Existing customers are re-used — no duplicates.
- `artwork_url` must be a **publicly accessible URL**. The file is linked as an external asset (not downloaded). Accepted formats: PDF, PNG, JPG, AI, EPS, etc.
- Per-SKU `artwork_url` is stored against that specific SKU. Order-level `artwork_url` is stored as a general attachment.
- Billing fields (`source_url`, `payment_status`, `deposit`, `balance`) are stored in `orders.specs.billing` and shown via a **globe** icon next to the priority chip. If none are sent, no globe appears.
- `designer_information` / `designer_notes` fill the **Designer Information** custom field only.
- `design_task` must be an **http(s) URL** for **Design files** (GDrive job folder). Non-URL text is treated as Order Description content.
- `notes` / `internal_note` land on the card **Notes** tab.
- Per-SKU `description` / `comment` values are combined into the **Notes** tab as:
  ```
  SKU1: first line comment
  SKU2: second line comment
  ```
- `title` after the source label — omit or send empty to leave blank; do not fall back to `order_number`.
- **Owner** fields (`owner_*` / `request_owner_*`) set the card Owner dropdown only when the user is an **account manager** on your team. Free-text `request_owner_name`, `request_owner_contact`, and `request_owner_phone` are always saved on the card.
- New cards always land in the **first board column**.
- **Artwork GDrive link:** Optionally auto-created via **Settings → GDrive**. Single-item: `26-0098_Customer Name` / `26-0098_Final for Prod`. Multi-item: `26-0098_Customer Name_1` / `26-0098_Final for Prod_1` (and `_2`, …) with each card linked to its own folder. Otherwise staff enter it in the app.
- **Design files** (`specs.design_task`) is set to the GDrive **job folder** URL when GDrive automation runs.
- **⚠️ Rotate your webhook secret before going to production.** Settings → Integrations → Webhook → Regenerate.

---

## Code Examples

### curl
```bash
curl -X POST https://workflow-rho-one.vercel.app/api/webhook/orders \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_SECRET_KEY" \
  -d '{
    "customer_name": "Acme Corp",
    "customer_contact": "hello@acme.com",
    "order_number": "ORD-2026-001",
    "product": "Labels (Roll)",
    "materials": "White BOPP",
    "order_qty": 3000,
    "due_date": "2026-07-24"
  }'
```

### JavaScript / Node.js
```js
const res = await fetch('https://workflow-rho-one.vercel.app/api/webhook/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': process.env.WORKFLOW_WEBHOOK_SECRET,
  },
  body: JSON.stringify({
    customer_name: 'Acme Corp',
    customer_contact: 'hello@acme.com',
    order_number: 'ORD-2026-001',
    product: 'Labels (Roll)',
    materials: 'White BOPP',
    order_qty: 3000,
    due_date: '2026-07-24',
    artwork_url: 'https://yourdomain.com/files/artwork.pdf',
  }),
});

const data = await res.json();
if (!res.ok) throw new Error(data.error);
console.log('Created order:', data.order_number, data.order_id);
```

### Python
```python
import requests, os

res = requests.post(
    'https://workflow-rho-one.vercel.app/api/webhook/orders',
    headers={
        'Content-Type': 'application/json',
        'x-webhook-secret': os.environ['WORKFLOW_WEBHOOK_SECRET'],
    },
    json={
        'customer_name': 'Acme Corp',
        'customer_contact': 'hello@acme.com',
        'order_number': 'ORD-2026-001',
        'product': 'Labels (Roll)',
        'materials': 'White BOPP',
        'order_qty': 3000,
        'due_date': '2026-07-24',
        'artwork_url': 'https://yourdomain.com/files/artwork.pdf',
    }
)
res.raise_for_status()
data = res.json()
print('Created:', data['order_number'], data.get('order_id'))
```

---

*Last updated: June 2026*
