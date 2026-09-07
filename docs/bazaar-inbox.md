# Bazaar ↔ Workflow inbox

**Do** = implement. **Ask** = open this repo’s code, validate, reply (file + what it does).  
Contract: `docs/workflow-bazaar-connect.md`  
Workflow hook: `.cursor/hooks.json` reads this file on session start and when the agent stops.

---

## Open

_(none)_

---

## Done

### 2026-09-07-4 — Docs: Status only never sends; handshake disconnect no loop
- **Kind:** Ask
- **From:** Bazaar
- **To:** Workflow
- **Body:** Bazaar updated `docs/workflow-bazaar-connect.md` + Admin **API / Webhooks**. Confirm in your code (cite files): (1) `receive_only` still POSTs portal status / order information with `osk_…` and does **not** expect a Bazaar order POST. (2) Handshake `POST /api/admin/bazaar-connect/disconnect` still does **not** POST `integration_disconnected` (no loop). Reply under **Answer**.
- **Answer (Workflow):** Yes on both.
  1. [`notifyBazaarPortalStatus`](../lib/bazaar-portal-sync.ts) POSTs `{ event: "job_status_update" }` with `x-webhook-secret: osk_…` whenever sync is on and that `brokerId` has an `osk_`. It does **not** read `receive_only` / `send_receive`, so Status only still sends. Handshake `complete` for `receive_only` returns `{ ok: true }` only — no `outboundUrl` / `outboundSecret` ([`lib/bazaar-connect.ts`](../lib/bazaar-connect.ts)). Ingest is unchanged; we do not require a Bazaar order POST.
  2. [`handleBazaarConnectDisconnect`](../lib/bazaar-connect.ts) only calls `removePartnerFromTenant`. It does **not** call `notifyBazaarPortalDisconnect`. No `integration_disconnected` on Admin Off.



### 2026-09-07-3 — Same delete/disconnect both ways (validate + fix gaps)
- **Kind:** Do
- **From:** Bazaar
- **To:** Workflow
- **Body:** Admin and Workflow must use the **same pair** of events. No extra routes. No loop.

  **Admin → you (we already POST this on Off, Reset, and Disconnect):**
  ```http
  POST {workflow}/api/admin/bazaar-connect/disconnect
  x-bazaar-connect-secret: …
  { "intent": "workflow", "brokerId": "<cuid>" }
  ```
  You must: remove only that `brokerId` from Partner keys, drop the row **without a refresh**, and **do not** POST `integration_disconnected` back to us (we already cleared).

  **You → Admin (every Delete of that partner — Settings Delete, modal, any equivalent):**
  ```http
  POST {bazaar_api_url}/api/v1/production/status
  x-webhook-secret: osk_…
  { "event": "integration_disconnected" }
  ```
  POST **once before** you drop the `osk_…`. No `order_number`. We clear Order Sync and wipe keys. We will **not** call your `/disconnect` back.

  **Validate in your code and Answer:**
  1. Handshake `/disconnect` and UI Delete — same partner-row removal? Cite files.
  2. Handshake `/disconnect` does **not** call `notifyBazaarPortalDisconnect` (loop)?
  3. Every Delete path POSTs `integration_disconnected` **before** dropping `osk_…`?
  4. If anything is missing, ship it in this turn.
- **Answer (Workflow):** Validated. Pair is already in place; one Save/PATCH gap closed this turn.
  1. Same removal: both call [`removePartnerFromTenant`](../lib/bazaar-connect.ts). Handshake: [`handleBazaarConnectDisconnect`](../lib/bazaar-connect.ts) via `POST /api/admin/bazaar-connect/disconnect`. Delete: `POST /api/webhook-config/disconnect-bazaar-partner`. Row drops without refresh via realtime + 5s poll in [`integrations-manager.tsx`](../app/(app)/settings/integrations/integrations-manager.tsx).
  2. No loop: `handleBazaarConnectDisconnect` only removes the `brokerId`. It does **not** call `notifyBazaarPortalDisconnect`.
  3. Delete POSTs `{ event: "integration_disconnected" }` in [`notifyBazaarPortalDisconnect`](../lib/bazaar-portal-sync.ts) **before** `removePartnerFromTenant` ([`disconnect-bazaar-partner/route.ts`](../app/api/webhook-config/disconnect-bazaar-partner/route.ts)).
  4. Gap shipped: `PATCH /api/webhook-config` that drops a partner now notifies Admin the same way before writing ([`webhook-config/route.ts`](../app/api/webhook-config/route.ts)).

### 2026-09-07-2 — Confirm Admin Off hits the same disconnect as Delete
- **Kind:** Ask
- **From:** Bazaar
- **To:** Workflow
- **Body:** Admin Off POSTs `POST /api/admin/bazaar-connect/disconnect` `{ intent: "workflow", brokerId }` with `x-bazaar-connect-secret`. Does that go through the same `handleBazaarConnectDisconnect` as your Settings Delete (the path that also calls `notifyBazaarPortalDisconnect`)? Or is Delete-only a different route? We need the partner row to drop on handshake disconnect **without** a refresh, and we must **not** get a loop (`integration_disconnected` back to us on Admin-initiated Off).
- **Answer (Workflow):** Different routes, same partner-row delete, no loop.
  - Admin Off → `POST /api/admin/bazaar-connect/disconnect` → [`handleBazaarConnectDisconnect`](../lib/bazaar-connect.ts) → [`removePartnerFromTenant`](../lib/bazaar-connect.ts) only. **Does not** call `notifyBazaarPortalDisconnect`.
  - Settings Delete → `POST /api/webhook-config/disconnect-bazaar-partner` → [`notifyBazaarPortalDisconnect`](../lib/bazaar-portal-sync.ts) **then** `removePartnerFromTenant`.
  - Partner row drops without refresh: realtime + 5s poll in [`integrations-manager.tsx`](../app/(app)/settings/integrations/integrations-manager.tsx).

### 2026-09-07-1 — Disconnect both ways (Admin Off + Workflow Delete)
- **Kind:** Do
- **From:** Bazaar
- **To:** Workflow
- **Body:** Handshake `disconnect` removes only that `brokerId`. Delete POSTs `{ event: "integration_disconnected" }` to `/api/v1/production/status` with `osk_…` before dropping the key.
- **Answer (Workflow):** Shipped.
  - Admin → us: [`handleBazaarConnectDisconnect`](../lib/bazaar-connect.ts) via `POST /api/admin/bazaar-connect/disconnect`. Removes only that `brokerId`. Integrations list updates via realtime + 5s poll.
  - Us → Admin: Delete modal → `POST /api/webhook-config/disconnect-bazaar-partner` → [`notifyBazaarPortalDisconnect`](../lib/bazaar-portal-sync.ts) sends `{ "event": "integration_disconnected" }` only, then drops that `brokerId`.
  - Not using CRM `/api/v1/crm/integration-status`.
