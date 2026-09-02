# Inbound order webhook

The full field list and examples live in **Settings → Integrations → Webhook** (`lib/webhook-payload-docs.ts`). This page documents Admin catalog mapping.

## Source vs catalog

| Field | Meaning | Values |
|---|---|---|
| `source` | Who sent the job (board chip) | `crm` / `portal` / `website` |
| `catalog_source` | Item vocabulary (optional tag) | `admin` / omit |

`catalog_source` is **not** a board source. CRM Bazaar quotes, partner Order Sync, and broker Order Sync use the **same** Admin mapper. Only the source chip differs (`crm` vs `portal`).

## Admin-shaped line

A line is Admin-shaped when **that line** has `spec_selections.bazaar_item_id` as a finite number > 0 (numeric string accepted).

Order-level `catalog_source: "admin"` alone does **not** force every line onto identity. Mixed carts decide per line so a legacy sibling stays on today's aliases.

Flat payloads (no `items[]`) may put `spec_selections` on the body; Workflow copies them onto the synthetic item.

```json
{
  "source": "crm",
  "catalog_source": "admin",
  "order_number": "ORD-2026-TEST-ADMIN",
  "items": [{
    "product": "Roll Labels",
    "die": "Stizzy 1g preroll DIELINE",
    "width": 2.65,
    "height": 2.9,
    "spec_selections": {
      "bazaar_item_id": 23,
      "SET_SIZE": "2.65x2.9",
      "BAZAAR_DIE_ID": 44
    }
  }]
}
```

Portal/broker: same item fields, `source: "portal"`. Mapping-only fixture (no Admin status callback — that requires `BZ-*`):

```json
{
  "source": "portal",
  "catalog_source": "admin",
  "order_number": "TEST-MAP-ROLL-23",
  "product": "Roll Labels",
  "materials": "White BOPP",
  "finished_size": "2.65 x 2.9 in",
  "die": "Stizzy 1g preroll DIELINE",
  "width": 2.65,
  "height": 2.9,
  "spec_selections": {
    "bazaar_item_id": 23,
    "SET_SIZE": "2.65x2.9",
    "DIE_NAME": "Stizzy 1g preroll DIELINE",
    "BAZAAR_DIE_ID": 44
  }
}
```

Owner/Admin `curl` POSTs that to `/api/webhook/orders` with the tenant `wh_live_…` header. Do not send `schema_version: 2`. Do not send artwork URLs on this fixture. Delete the card by searching `TEST-MAP-ROLL-23`.

## Mapping

On **create** and **portal/CRM re-fire** (`refreshPortalOrdersFromWebhook`):

- **Product / Materials:** skip catalog remap, alias, and fuzzy. Exact option match (case/whitespace insensitive) or store the Admin string as-is.
- **Die:** persist as text.
- **Size:** persist `SET_SIZE` + width/height/`finished_size` as sent. No Finished Size select alias.
- **Other selects** (lamination, sides, color_mode, roll_direction): existing alias/fuzzy.
- **Category:** do not force Folding Cartons after Product stays Mini Tuck End Box.
- **Legacy** (no `bazaar_item_id`): existing aliases (`Roll Labels` → `Labels (Roll)`).

Workflow does not call Admin HTTP. `schema_version === 2` connected-mode routing is unchanged. Status callbacks Workflow → Admin (`bazaar-portal-sync`) are unchanged.
