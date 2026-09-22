# Website → Workflow webhook prompt

Copy everything below the line and paste it to the Website team / agent.

---

You are building the JSON body that the Bazaar Printing **website checkout** POSTs to **Workflow** (`POST /api/webhook/orders`, header `x-webhook-secret`).

Your job: take a completed website order (cart lines, customer, payment, every selected option) and emit **one JSON body**. Do not invent identity. Do not wrap in markdown. Do not wrap in `{ "data": ... }`. Do not drop options because they are “custom,” “optional,” or “weird.”

**If the customer saw it or selected it on the site, it must be in the payload.** Workflow only stores what you send. Missing size/options on the card means you omitted them.

## Endpoint

```
POST {WORKFLOW_WEBHOOK_URL}
Content-Type: application/json
x-webhook-secret: {WORKFLOW_WEBHOOK_SECRET}
```

`source` **must** be `"website"` (not `"crm"`, not `"portal"`).

`order_number` = the website order id as a string (example `"158"`). Workflow titles cards `W158-1`, `W158-2`, …. Re-POST the same `order_number` to update; do not mint a new number.

## Hard rules (do not violate)

1. **One POST = one website order. Each cart line = one `items[]` entry = one board card.** Always send `items: [ ... ]`, even for a single line.
2. **Never send `0`, `"0"`, `"0 x 0"`, `"None"`, `"N/A"`, or `"-"` for size.** If the customer did not give a size, **omit** `width`, `height`, `finished_size`, and `spec_selections.SET_SIZE`. Fake zeros look filled and hide missing info (this already broke **W158 Custom Poly Tape**: website sent `width: 0`, `height: 0`, `finished_size: "0 x 0"`, and only `bazaar_item_id` — no `SET_SIZE`).
3. **Every product that has a size on the site must send a real size**, same as Roll Labels / Stickers / Pouches already do: numeric `width` + `height`, `finished_size` like `"3.3 x 7.5"`, **and** `spec_selections.SET_SIZE` (e.g. `"3.3x7.5"` or `"3.3x7.5x2"` for L×W×H). This includes **Custom Poly Tape**, pouches, boxes, labels, stickers, cards, flyers — **no exceptions**.
4. **Copy every checkout option into `spec_selections`.** Do not send only `{ "bazaar_item_id": 57 }`. Include every selected key: `SET_SIZE`, `ROLL_DIRECTION`, `BAZAAR_DIE_ID`, `DIE_NAME`, material keys, coating, adhesive, core, wind, application, box size, custom fields, etc. Values = what the customer chose. Ids stay in `spec_selections`; humans go in `spec_display`.
5. **Also send `spec_display`:** array of `{ "key", "label", "value" }` for every option shown on the packing/checkout UI (Size, Die, Material, Wind, Core, …). No mapper ids in `spec_display`. Workflow shows these on the floor card and **does not call Admin/CRM to resolve ids**.
6. **Flatten known specs onto the line** as well as `spec_selections` (belt and suspenders):
   - `product` = Admin item name (exact catalog name, e.g. `"Custom Poly Tape"`)
   - `materials` / `material`
   - `sides` (e.g. `"1 Side"` or `"Single-sided"`)
   - `product_category` (Category dropdown — website currently never sends this)
   - `finishing` and/or `lamination`
   - `color` / `color_mode`
   - `roll_direction`
   - `die` / `cutting_type`
   - `special_effects` (string or string[])
   - booleans: `spot_uv`, `foil`, `die_cut`, `application`, `need_a_design`, `perforation`
7. **`product_options`:** if the cart still has a raw list of selected option labels, send it (`string[]`) in addition to structured fields. Do not throw it away.
8. **Empty selects:** omit the key or send `""`. Never `"None"`.
9. **Money:** numbers (`unit_price`, `deposit`, `balance`).
10. **Dates:** `due_date` = `YYYY-MM-DD`.
11. **`design_task` / artwork:** http(s) URLs only (Drive folder or file). Customer uploads → `artwork_url` and/or `items[].files_url` / `item_folder_url`.
12. **Do not put `order_number` in `title`.** Line `title` = product/line name (`"Custom Poly Tape"`).

## Always send when the checkout has the value

### Order level

| Field | Why |
|---|---|
| `source` | `"website"` |
| `order_number` | Website order id (string) |
| `customer_name` | Card + SMS |
| `customer_contact` | Email |
| `customer_phone` | E.164 if possible |
| `due_date` | If checkout computed one |
| `due_date_mode` | `"fixed"` when calendar date is known |
| `due_date_status` | `"set"` when date is known |
| `payment_status` | `"full"` or `"partial"` (`paid` / `complete` → full) |
| `deposit` | Amount paid |
| `balance` | Remaining |
| `source_url` | Public/admin URL of this website order (billing globe) |
| `description` | Customer notes from checkout |
| `notes` / `internal_note` | Internal |
| `production_notes` | Floor notes (keep strings like `"Sides: 1 Side"` **and** still send structured `sides`) |
| `rush` | `true` if rush checkout |
| `priority` | `normal` \| `high` \| `low` \| `urgent` |
| `catalog_source` | `"admin"` when lines use Admin items |

### Each `items[]` line

| Field | Why |
|---|---|
| `title` | Line name |
| `product` | Admin `Item.name` |
| `bazaar_item_id` **inside** `spec_selections` | Finite number `> 0` (marks Admin-shaped line) |
| `materials` | Substrate / stock |
| `width` + `height` | Real numbers only; omit if unknown |
| `finished_size` | `"W x H"` (never `"0 x 0"`) |
| `spec_selections.SET_SIZE` | `"WxH"` or `"LxWxH"` |
| `spec_display` | Human rows for **all** selected options |
| `sides`, `color_mode`, `roll_direction`, `lamination`/`finishing`, `die` | If the PDP/cart had them |
| `quantity` **and** `order_qty` | Print qty (not SKU row count) |
| `unit_price` | Line unit price |
| `skus[]` | `{ sku_name, quantity, artwork_url }` |
| `artwork_url` / `files_url` / `item_folder_url` | Files |
| `line_item_comment` / `production_notes` | Per-line floor notes |
| `product_category` | Taxonomy for Category dropdown |
| `product_options` | Raw leftover option labels |

`sku_qty` = number of SKU **rows**, not print qty.

## Size (the W158 failure)

**Bad (W158 — lost size):**

```json
"width": 0,
"height": 0,
"finished_size": "0 x 0",
"spec_selections": { "bazaar_item_id": 57 }
```

**Good (same pattern as W163 Roll Labels):**

```json
"width": 3.3,
"height": 7.5,
"finished_size": "3.3 x 7.5",
"spec_selections": {
  "bazaar_item_id": 57,
  "SET_SIZE": "3.3x7.5",
  "ROLL_DIRECTION": "Reprint"
},
"spec_display": [
  { "key": "SIZE", "label": "Size", "value": "3.3 x 7.5 in" },
  { "key": "ROLL_DIRECTION", "label": "Wind", "value": "Reprint" }
]
```

If tape/pouches/boxes collect length × width × caliper, send all three in `SET_SIZE` (`"2x2x0.5"`) and in `spec_display`. If the product has **no size UI**, omit size keys — do not invent zeros. **Fix the PDP** if production needs a size (tape must collect width × length).

## Template (drop keys you truly do not have — never fill with 0)

```json
{
  "source": "website",
  "catalog_source": "admin",
  "order_number": "158",
  "customer_name": "",
  "customer_contact": "",
  "customer_phone": "",
  "due_date": "YYYY-MM-DD",
  "due_date_mode": "fixed",
  "due_date_status": "set",
  "payment_status": "full",
  "deposit": 0,
  "balance": 0,
  "source_url": "https://…/orders/158",
  "description": "",
  "production_notes": "",
  "items": [
    {
      "title": "Custom Poly Tape",
      "product": "Custom Poly Tape",
      "product_category": "",
      "materials": "White Poly Tape",
      "sides": "1 Side",
      "width": 2,
      "height": 110,
      "finished_size": "2 x 110",
      "finishing": "",
      "lamination": "",
      "color_mode": "",
      "roll_direction": "",
      "die": "",
      "special_effects": [],
      "unit_price": 18,
      "quantity": 1,
      "order_qty": 1,
      "spot_uv": false,
      "foil": false,
      "die_cut": false,
      "application": false,
      "need_a_design": false,
      "perforation": false,
      "artwork_url": "",
      "files_url": "",
      "production_notes": "",
      "product_options": [],
      "spec_selections": {
        "bazaar_item_id": 57,
        "SET_SIZE": "2x110"
      },
      "spec_display": [
        { "key": "SIZE", "label": "Size", "value": "2 x 110 in" },
        { "key": "MATERIALS", "label": "Material", "value": "White Poly Tape" },
        { "key": "SIDES", "label": "Sides", "value": "1 Side" }
      ],
      "skus": [
        { "sku_name": "Custom Poly Tape", "quantity": 1, "artwork_url": "" }
      ]
    }
  ]
}
```

## Acceptance check before you POST

- [ ] `source` is `"website"`
- [ ] Every cart line is in `items[]`
- [ ] `spec_selections.bazaar_item_id` > 0 for Admin items
- [ ] **Every selected option** is in `spec_selections` **and** `spec_display`
- [ ] Size is real **or omitted** — never `0` / `"0 x 0"`
- [ ] Tape and any custom-size item include `SET_SIZE` when the customer entered size
- [ ] Customer name + email + phone present
- [ ] Payment fields present when paid
- [ ] Artwork/Drive URLs present when the customer uploaded files
- [ ] No option exists only in the website DB / `product_options` dump and missing from JSON

**Definition of done:** a production person can print the job from the Workflow card without opening the website, including **Custom Poly Tape** size.
