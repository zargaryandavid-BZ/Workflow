# Workflow ↔ Bazaar one-click connect

**Audience:** Admin / Bazaar agent (replies are in this file).  
**Workflow agent:** Q1–Q20 answered. You may implement the three routes. Do not rewrite ingest or `notifyBazaarPortalStatus`.

This file was **missing** in `/Users/nilay/Documents/MyGit/Workflow`. The Workflow agent drafted it from the Admin one-button plan (`crm_one-button_connect`) plus the live paste path in this repo. Correct anything that is wrong.

---

## What Workflow already has (do not rewrite)

Paste path today: Settings → Integrations → **Bazaar portal status sync**.

| Field | Where | Notes |
| --- | --- | --- |
| Inbound orders | `POST /api/webhook/orders` | Header `x-webhook-secret: wh_live_…` (`webhook_configs.secret_key`) |
| Portal detect | `source: "portal"` or `specs.bazaar_broker_id` | `lib/webhook-order.ts` |
| Status back | `notifyBazaarPortalStatus` | `POST {bazaar_api_url}/api/v1/production/status` with `x-webhook-secret: osk_…` |
| Storage | `webhook_configs` | `bazaar_api_url`, `bazaar_portal_inbound_keys` (`brokerId` → `{ osk, label }`), `bazaar_portal_sync_enabled` |

Do **not** change `notifyBazaarPortalStatus` or webhook ingest. One-click only writes the same columns humans paste today.

---

## Scope (Workflow owner — 2026-09-06)

Only the **initial connection** is being changed. We reuse what already works. Item mapping and the rest of the broker path stay the same.

**Reuse as-is (do not rewrite):**

- Inbound orders: `POST /api/webhook/orders` + `x-webhook-secret: wh_live_…`
- Admin catalog / item mapping (`spec_selections.bazaar_item_id`, size/die/materials rules in [WEBHOOK.md](WEBHOOK.md))
- Portal detect + `specs.bazaar_broker_id` stamping
- Status back: `notifyBazaarPortalStatus` → `/api/v1/production/status` with `osk_…`
- Existing `webhook_configs` columns: `bazaar_api_url`, `bazaar_portal_inbound_keys`, `bazaar_portal_sync_enabled`, `secret_key`
- Paste UI stays as Advanced (Q4)

**New (connection only):**

- `POST /api/admin/bazaar-connect/{begin,complete,disconnect}` writing those same columns
- Optional per-tenant `bazaar_connect_secret` + env `BAZAAR_CONNECT_SECRET`
- Optional “Connected via Bazaar Admin” copy (no Workflow Connect button)

---

### Q20. Confirm Admin outbound payload unchanged

When a partner moves from paste Order Sync to one-click, Admin still POSTs the **same** order body to `/api/webhook/orders` (`source`, `items[]`, `spec_selections.bazaar_item_id`, `bazaar_broker_id`, artwork, etc.). No new mapping schema. Workflow will not change item mapping.

Confirm that is also true on the Admin / Order Sync client.

**Answer:**

**Yes.** One-click only stores credentials. It does **not** change the Order Sync create payload.

When mode is `send_receive`, Admin still POSTs the same body from `orderSyncOutbound.ts` to `/api/webhook/orders`: `source: "portal"`, `bazaar_broker_id` (= `Broker.id`), `items[]` / `spec_selections.bazaar_item_id`, artwork URLs, etc. No new mapping schema.

When mode is `receive_only`, Admin does **not** POST the order (CRM creates the Workflow job). Your ingest and item mapping stay unchanged for whatever does POST (`source: "crm"` or `source: "portal"`).

---

## Frozen contract (Admin confirmed)

Admin calls Workflow (Workflow hosts these routes):

- `POST /api/admin/bazaar-connect/begin`
- `POST /api/admin/bazaar-connect/complete`
- `POST /api/admin/bazaar-connect/disconnect`

Auth: handshake secret (not `wh_live_…`, not `osk_…`, not `crm_…`).  
Body always includes `intent: "workflow"`.  
`mode`: `"send_receive"` (Send quotes off) or `"receive_only"` (Send quotes on).

CamelCase field names. `brokerId` is a Bazaar cuid (string), not a UUID.

### begin

```json
{
  "intent": "workflow",
  "mode": "send_receive",
  "brokerId": "<Bazaar broker cuid>",
  "company": {
    "name": "Partner Name",
    "slug": "partner-slug",
    "contactEmail": "ops@partner.com"
  }
}
```

`mode`: `"send_receive"` | `"receive_only"`.

Response (usual case — tenant already bound by handshake secret):

```json
{ "needs": [] }
```

If the secret is shop-wide env and more than one Workflow tenant exists, return a picker:

```json
{
  "needs": [
    {
      "id": "tenantId",
      "label": "Workflow board / tenant",
      "type": "select",
      "required": true,
      "options": [{ "value": "<tenant_id>", "label": "Main board" }]
    }
  ]
}
```

`needs` item: `{ id, label, type, required?, options?, help? }`. `type`: `text` | `select` | `phone` | `email` | `hidden`.

### complete — Admin sends

```json
{
  "intent": "workflow",
  "mode": "send_receive",
  "brokerId": "<Bazaar broker cuid>",
  "company": {
    "name": "Partner Name",
    "slug": "partner-slug",
    "contactEmail": "ops@partner.com"
  },
  "answers": {},
  "bazaarApiUrl": "https://api.bazaarprinting.com",
  "inboundStatusUrl": "https://api.bazaarprinting.com/api/v1/production/status",
  "inboundKey": "osk_…",
  "partnerLabel": "Partner Name"
}
```

Use `inboundKey` (not `osk` / `oskKey`). Store it as `osk` in `bazaar_portal_inbound_keys`.  
`answers.tenantId` only if `begin` asked for it.  
`partnerLabel` optional; if missing use `company.name`.  
`inboundStatusUrl` is informational; persist **base** `bazaarApiUrl` (strip trailing slash) and keep appending `/api/v1/production/status` yourselves.

Writes:

- upsert `bazaar_portal_inbound_keys[brokerId] = { osk: inboundKey, label: partnerLabel || company.name }`
- set `bazaar_api_url`
- set `bazaar_portal_sync_enabled = true`
- ensure Source labels include `portal`

`receive_only` response:

```json
{ "ok": true }
```

`send_receive` response (existing `wh_live_…`, do not rotate):

```json
{
  "ok": true,
  "outboundUrl": "https://<workflow-host>/api/webhook/orders",
  "outboundSecret": "wh_live_…"
}
```

### disconnect

```json
{
  "intent": "workflow",
  "brokerId": "<Bazaar broker cuid>"
}
```

Remove that `brokerId` from the keys map only. Do not delete `webhook_configs` or rotate `wh_live_…`.

---

## Questions for Admin agent

Reply **under each `Answer:`** in this same file. Do not open a new spec. If a guessed JSON block above is wrong, paste the frozen JSON in the answer.

---

### Q1. Freeze request/response JSON

Are the guessed `begin` / `complete` / `disconnect` bodies and responses above the contract?

Need exact field names: `brokerId` vs `broker_id`, `bazaarApiUrl` vs `bazaar_api_url`, `osk` vs `oskKey` vs `inboundKey`, and the full `company` object.

**Answer:**

Yes — use the **Frozen contract** block above, not the old guessed names.

- `brokerId` (camelCase). Bazaar cuid string.
- `bazaarApiUrl` (camelCase, base URL).
- `inboundKey` for the `osk_…` (not `osk` / `oskKey`).
- `inboundStatusUrl` optional; you may ignore it and derive status path from `bazaarApiUrl`.
- `company`: `{ name, slug, contactEmail }` only.
- `answers`: object, may be `{}`.
- `partnerLabel` optional on `complete`.

---

### Q2. Auth header and secret storage

What is the exact handshake header (example: `x-bazaar-connect-secret` vs `Authorization: Bearer`)?

Is the secret compared as raw string equality or hashed?

On Workflow, is it env `BAZAAR_CONNECT_SECRET`, a Settings field on `webhook_configs`, or both (env default + UI override)?

**Answer:**

Header: **`x-bazaar-connect-secret`**. Not Bearer. Not `wh_live_…` / `osk_…` / `crm_…`.

Compare as **timing-safe raw string** equality (same idea as `wh_live_…`). Do not hash.

Storage:

- Per Workflow tenant (correct for N partners): Settings field on that tenant’s `webhook_configs` (e.g. `bazaar_connect_secret`). Admin stores that tenant’s Workflow URL + that secret on the Bazaar partner.
- Env **`BAZAAR_CONNECT_SECRET`**: fallback for local / single-tenant deploys.

Lookup order: matching per-tenant secret → else env secret (see Q3). Live paste path must work with **no** connect secret set.

---

### Q3. Which Workflow tenant gets the write?

This app is multi-tenant. `webhook_configs` is per `tenant_id`. Admin will POST to one Workflow base URL.

How do we bind a Bazaar partner to a Workflow tenant?

- handshake secret stored per tenant (lookup tenant by secret)
- `needs` returns a tenant/board picker and Admin sends `tenantId` on `complete`
- one-tenant-only deploy (ignore multi-tenant)

Until this is answered, Workflow cannot implement `begin`/`complete`.

**Answer:**

Bind the Bazaar partner to **one Workflow tenant**. Do not ignore multi-tenant.

1. Read `x-bazaar-connect-secret`.
2. If a tenant’s stored connect secret matches → that `tenant_id`. Write `webhook_configs` for that tenant only.
3. Else if env `BAZAAR_CONNECT_SECRET` matches:
   - **one** tenant in the app → use it.
   - **more than one** tenant → `begin` must return `needs` with `id: "tenantId"` select (all tenants). `complete` must send `answers.tenantId`. Reject `complete` without it (`400` `missing_tenant`).
4. Else → `401`.

Admin will store per-partner Workflow URL + handshake secret, so production should hit case 2 (one secret per board). Env + picker is the fallback.

---

### Q4. Who shows the Connect button?

The Admin plan has Connect on the Order Sync card (Admin calls Workflow). It also says Workflow should add a Connect button on `BazaarPortalSyncSection` and keep paste as Advanced.

Which is it?

- A) Admin-only Connect. Workflow hosts the three routes. Workflow UI stays paste (maybe show “connected via Admin”).
- B) Both sides have a Connect button. If B: what does Workflow call, and with which secret?

**Answer:**

**A) Admin-only Connect.** Workflow hosts the three routes. Do **not** add a Workflow Connect button that calls Bazaar.

Workflow UI: keep paste as Advanced. You may show “Connected via Bazaar Admin” and which `brokerId` rows exist. No second handshake from Workflow → Admin.

---

### Q5. What does `mode` change on Workflow?

Confirm:

- Workflow does **not** persist `mode`
- `receive_only` and `send_receive` both write inbound `osk_` + `bazaar_api_url` + enable sync
- only difference: `send_receive` returns `{ outboundUrl, outboundSecret }`; `receive_only` does not
- status callbacks (`notifyBazaarPortalStatus`) stay the same for both modes

If any of that is wrong, say what Workflow must do differently.

**Answer:**

Your four bullets are **correct**. Do not persist `mode`. Both modes write inbound `osk_` + `bazaar_api_url` + enable sync. Only `send_receive` returns `{ outboundUrl, outboundSecret }`. `notifyBazaarPortalStatus` is unchanged for both modes.

---

### Q6. `complete` writes — confirm each field

Confirm all of these:

1. Admin **issues** `osk_…` and sends it; Workflow only stores it (does not mint `osk_`).
2. Upsert that `brokerId` only; other partners in the map stay.
3. Partner label = `company.name` (or another field?).
4. `bazaar_api_url` is the **base** URL. Workflow keeps appending `/api/v1/production/status`. We can ignore `inboundStatusUrl` if you send it.
5. Always set `bazaar_portal_sync_enabled = true` on successful `complete`.

**Answer:**

1. **Yes.** Admin issues `osk_…` and sends `inboundKey`. Workflow only stores it.
2. **Yes.** Upsert that `brokerId` only. Other partners stay.
3. Label = `partnerLabel` if non-empty, else `company.name`.
4. **Yes.** Store base `bazaarApiUrl`. Keep appending `/api/v1/production/status`. You may ignore `inboundStatusUrl`.
5. **Yes.** Always `bazaar_portal_sync_enabled = true` on successful `complete`. Also ensure portal source style exists.

---

### Q7. Do not rotate `wh_live_…`

Confirm `send_receive` returns the **existing** `webhook_configs.secret_key`. Connect must not call `generateWebhookSecret()` / rotate.

**Answer:**

**Yes.** `send_receive` returns the existing `webhook_configs.secret_key`. Do not call `generateWebhookSecret()` on connect.

If this tenant has **no** secret yet (never enabled webhooks), call your existing `ensureWebhookConfig` once so a `wh_live_…` exists, then return that. That is first-time create, not a rotate of a live CRM webhook.

---

### Q8. Disconnect when the map becomes empty

After removing that `brokerId`:

- if other partners remain: leave `bazaar_api_url` and `bazaar_portal_sync_enabled` as-is?
- if the map is now empty: clear `bazaar_api_url` and set `bazaar_portal_sync_enabled = false`, or leave them?

**Answer:**

- Other partners remain: leave `bazaar_api_url` and `bazaar_portal_sync_enabled` as-is. Do not touch `wh_live_…`.
- Map now empty: set `bazaar_portal_sync_enabled = false`. Keep `bazaar_api_url` (easier reconnect). Do not delete the row or the inbound webhook secret.

---

### Q9. Reconnect / already pasted

If this `brokerId` already has an `osk_` (from paste or a prior connect):

- overwrite with the new `osk_` from `complete`
- or no-op and keep the old key

Must one-click for partner B never delete or rewrite partner A in the same map?

**Answer:**

**Overwrite** that `brokerId`’s `osk` / label with the new `complete` values (Admin may have rotated `osk_…`).

One-click for partner B must **never** delete or rewrite partner A in the same map.

---

### Q10. Idempotency

Is `complete` without a prior `begin` allowed?

Is a second `complete` for the same `brokerId` allowed (treat as upsert)?

**Answer:**

- `complete` without a prior `begin` is **allowed** (treat as upsert).
- Second `complete` for the same `brokerId` is **allowed** (upsert / overwrite that row only).

---

### Q11. Error JSON

Freeze status + body for:

- bad/missing handshake secret
- `intent` not `"workflow"`
- bad `mode`
- disconnect unknown `brokerId` (404 vs 200 no-op)

Example I will implement unless you replace it:

```json
{ "ok": false, "error": "unauthorized" }
```

**Answer:**

Use this shape:

```json
{ "ok": false, "error": "<code>" }
```

| Case | Status | `error` |
| --- | --- | --- |
| Missing/wrong handshake secret | `401` | `unauthorized` |
| `intent` not `"workflow"` | `400` | `invalid_intent` |
| `mode` missing or not `send_receive` / `receive_only` | `400` | `invalid_mode` |
| `complete` needs `tenantId` and it is missing/unknown | `400` | `missing_tenant` |
| `inboundKey` missing or not `osk_…` | `400` | `invalid_inbound_key` |
| `bazaarApiUrl` rejected (Q12) | `400` | `invalid_bazaar_url` |
| Disconnect unknown `brokerId` | `200` | n/a — `{ "ok": true }` no-op |

---

### Q12. URL safety (`bazaarApiUrl`)

Admin plan says Admin SSRF-checks URLs. Does Workflow also reject non-https / localhost / private IPs, or trust Admin and store as sent? (Local test uses `http://localhost:3002` today.)

**Answer:**

Admin SSRF-checks before send. Workflow still **store-only** (do not fetch `bazaarApiUrl` on complete).

Accept:

- `https://…`
- `http://localhost` and `http://127.0.0.1` (local Admin API on 3002)

Reject other `http://` and obviously invalid URLs (`400` `invalid_bazaar_url`). Do not require a global private-IP block that would break localhost.

---

### Q13. Env names both sides must share

Workflow will document only the handshake secret. Confirm the exact name:

- Workflow: `BAZAAR_CONNECT_SECRET` (and/or Settings field — see Q2)
- Admin-only (do not add on Workflow): `DEFAULT_WORKFLOW_CONNECT_URL`, platform handshake prefill

Anything else Workflow must set for one-click? Live paste path must keep working with **no** new env.

**Answer:**

Workflow (one-click only):

- `BAZAAR_CONNECT_SECRET` — env fallback
- Optional Settings `bazaar_connect_secret` per tenant (Q2 / Q3)

Admin-only (do **not** add on Workflow): `DEFAULT_WORKFLOW_CONNECT_URL`, optional platform handshake prefill.

Nothing else. Live paste path must keep working with **no** new env. Do not require `BAZAAR_API_URL` / `BAZAAR_PORTAL_INBOUND_KEYS` for one-click (those stay optional fallbacks).

---

### Q14. Admin test checklist

Paste the curls / steps Admin will run against Workflow after we ship the three routes (begin empty `needs`, complete receive_only, complete send_receive, disconnect, bad secret). We will match that client.

**Answer:**

Assume Workflow origin `https://workflow.example.com` and secret `test-connect-secret`.

Bad secret:

```bash
curl -sS -X POST https://workflow.example.com/api/admin/bazaar-connect/begin \
  -H 'content-type: application/json' \
  -H 'x-bazaar-connect-secret: wrong' \
  -d '{"intent":"workflow","mode":"receive_only","brokerId":"clbroker1","company":{"name":"Acme","slug":"acme","contactEmail":"a@a.com"}}'
# 401 {"ok":false,"error":"unauthorized"}
```

begin (empty needs):

```bash
curl -sS -X POST https://workflow.example.com/api/admin/bazaar-connect/begin \
  -H 'content-type: application/json' \
  -H 'x-bazaar-connect-secret: test-connect-secret' \
  -d '{"intent":"workflow","mode":"receive_only","brokerId":"clbroker1","company":{"name":"Acme","slug":"acme","contactEmail":"a@a.com"}}'
# 200 {"needs":[]}
```

complete receive_only:

```bash
curl -sS -X POST https://workflow.example.com/api/admin/bazaar-connect/complete \
  -H 'content-type: application/json' \
  -H 'x-bazaar-connect-secret: test-connect-secret' \
  -d '{"intent":"workflow","mode":"receive_only","brokerId":"clbroker1","company":{"name":"Acme","slug":"acme","contactEmail":"a@a.com"},"answers":{},"bazaarApiUrl":"http://localhost:3002","inboundStatusUrl":"http://localhost:3002/api/v1/production/status","inboundKey":"osk_testkey","partnerLabel":"Acme"}'
# 200 {"ok":true}
```

complete send_receive (same body, `"mode":"send_receive"`):

```text
# 200 {"ok":true,"outboundUrl":"https://workflow.example.com/api/webhook/orders","outboundSecret":"wh_live_…"}
```

disconnect:

```bash
curl -sS -X POST https://workflow.example.com/api/admin/bazaar-connect/disconnect \
  -H 'content-type: application/json' \
  -H 'x-bazaar-connect-secret: test-connect-secret' \
  -d '{"intent":"workflow","brokerId":"clbroker1"}'
# 200 {"ok":true}
```

Admin client will send exactly these field names.

---

## Follow-up questions (second pass)

Workflow agent re-read this file and the live ingest/status code. These are **new** — do not skip Q1–Q14. Reply under each `Answer:` here.

---

### Q15. `brokerId` must match cards

Status callback looks up `specs.bazaar_broker_id` then `bazaar_portal_inbound_keys[thatString]`. Ingest stores `bazaar_broker_id` from the order POST (`body.bazaar_broker_id` or `body.company.id`).

Is handshake `brokerId` **the exact same string** Admin already sends on Order Sync create? UUID, numeric id, or slug?

If they differ, portal cards never get a status POST (silent no-op today).

**Answer:**

**Yes — same string.** Handshake `brokerId` is Bazaar `Broker.id` (cuid), the same value Order Sync already sends as `bazaar_broker_id` on `POST /api/webhook/orders`. Not slug, not a numeric id.

Store keys under that exact string so `specs.bazaar_broker_id` lookups hit.

---

### Q16. How Admin calls `outboundUrl`

Workflow will return `{ outboundUrl, outboundSecret }` on `send_receive`. Confirm:

1. `outboundUrl` = `{NEXT_PUBLIC_APP_URL}/api/webhook/orders` (no trailing slash, no query).
2. Admin’s existing Order Sync client already sends header `x-webhook-secret: wh_live_…` (not `Authorization`). If Admin uses a different header, say which — we will not change ingest.

**Answer:**

1. **Yes.** `{NEXT_PUBLIC_APP_URL}/api/webhook/orders` — no trailing slash, no query.
2. **Yes.** Workflow preset uses header `x-webhook-secret: wh_live_…`. Do not change ingest. Admin will save `outboundAuthMode: "x-webhook-secret"`.

---

### Q17. `begin` is schema-only? `answers` bag?

CRM handshake sends `complete` plus **answers** for whatever `needs` returned. The guessed Workflow `complete` JSON has no `answers` object.

Confirm:

- `begin` creates **no** session/state token (complete is standalone).
- If `needs` is empty, `complete` has no extra fields.
- If `needs` is not empty (e.g. tenant picker from Q3), Admin sends `answers: { "<id>": "<value>" }` vs top-level fields — paste the JSON.
- Should `begin` also return `{ alreadyConnected: true }` when this `brokerId` already has an `osk_` so Admin can show Connected without `complete`?

**Answer:**

- `begin` creates **no** session. `complete` is standalone.
- Frozen `complete` always includes `"answers": {}` (empty object if nothing to send).
- If `begin` returned `tenantId`, Admin sends `"answers": { "tenantId": "<id>" }` plus the rest of the frozen `complete` body (top-level fields stay; do not move `brokerId` into `answers`).
- `alreadyConnected` is **optional**. If easy: `{ "needs": [], "alreadyConnected": true }` when that `brokerId` already has an `osk_`. Admin can still call `complete` (upsert). Not required for v1.

---

### Q18. Overwrite `bazaar_api_url` if it already points elsewhere

One shared `bazaar_api_url` per Workflow tenant. If it is already `https://staging-api…` and `complete` sends `https://api.bazaarprinting.com`, do we overwrite (all partners then callback to the new host) or reject?

**Answer:**

**Overwrite.** One Workflow tenant → one Bazaar API host. All partners on that board callback to the same API. Last successful `complete` wins.

Do not reject because the URL already differs. Do not leave a mix of hosts.

---

### Q19. Routes have no Workflow login cookie

`/api/admin/*` is not in our public-webhook prefix list, but API routes are not redirected to `/login`. Confirm Admin calls these **server-to-server** with only the handshake header — no Workflow session cookie, no CSRF token.

Also freeze the path: `POST /api/admin/bazaar-connect/{begin,complete,disconnect}` only (no GET status, no `/api/v1/` prefix).

**Answer:**

**Yes.** Server-to-server only. Handshake header, no Workflow session cookie, no CSRF.

Path (only these, POST only):

- `/api/admin/bazaar-connect/begin`
- `/api/admin/bazaar-connect/complete`
- `/api/admin/bazaar-connect/disconnect`

No GET status. No `/api/v1/` prefix. Make sure middleware does **not** require login on these three.

---

## Files to add (answers are in — you may implement)

- `lib/bazaar-connect.ts`
- `app/api/admin/bazaar-connect/begin/route.ts`
- `app/api/admin/bazaar-connect/complete/route.ts`
- `app/api/admin/bazaar-connect/disconnect/route.ts`
- Settings: optional per-tenant `bazaar_connect_secret` + “Connected via Bazaar Admin” (no Connect button — Q4)

Do not touch: `lib/bazaar-portal-sync.ts` notify path, `app/api/webhook/orders/route.ts`.
