# Documentation

**Last updated: June 23, 2026**

Complete project reference for developers and AI agents.

## Table of contents

### Start here

- [Project overview](#project-overview)
- [Tech stack](#tech-stack)
- [External services](#external-services)
- [Environment variables](#environment-variables)
- [Run locally](#run-locally)
- [Repository layout](#repository-layout)
- [Database overview](#database-overview-actual-table-names)
- [Naming glossary](#naming-glossary)
- [Multi-tenant architecture](#multi-tenant-architecture)
- [Key architectural decisions](#key-architectural-decisions)
- [Limitations](#whats-not-done--limitations)
- [Rules for AI agents](#rules-for-ai-agents-extending-this-codebase)

### Reference

1. [Architecture](#architecture)
2. [Database](#database)
3. [API routes](#api-routes)
4. [Components](#components)
5. [Workflows](#workflows)
6. [Deployment](#deployment)
7. [Known issues](#known-issues)

---

## Project overview

## What this project is

**Print Production Manager** (package name: `print-production-manager`) is a multi-tenant Kanban web app for print houses. Staff manage **orders** (print jobs) on a drag-and-drop board, attach artwork, notify customers for missing info or proof approval, and move cards through a production pipeline. Customers interact via tokenized public links (`/respond/[token]`) without logging in.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | **Next.js 16** (App Router), **React 19**, **TypeScript** |
| Styling | **Tailwind CSS v4** |
| Database / Auth / Storage / Realtime | **Supabase** (Postgres + RLS) |
| Drag-and-drop | **@dnd-kit** (`core`, `sortable`, `utilities`) |
| Data fetching (client) | **@tanstack/react-query** (limited use) |
| Icons | **lucide-react** |
| Hosting (intended) | **Vercel** |

> The user prompt mentioned Next.js 14; the repo currently uses **Next.js 16.2.7**.

## External services

| Service | Purpose | Env vars |
| --- | --- | --- |
| **Supabase** | Postgres, Auth, Storage, Realtime | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Instantly** | Customer notification emails, team invite emails | `INSTANTLY_API_KEY`, `INSTANTLY_FROM_EMAIL` |
| **Twilio** | Customer SMS notifications | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |

If Instantly/Twilio are unset, links are **logged to the server console** instead of sent.

## Environment variables

Copy `.env.local.example` → `.env.local`.

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key (browser + server with cookies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key — **server only**; bypasses RLS for token routes and invites |
| `NEXT_PUBLIC_APP_URL` | Yes | Public app base URL for customer links (e.g. `http://localhost:3000`) |
| `INSTANTLY_API_KEY` | No | Instantly API v2 key |
| `INSTANTLY_FROM_EMAIL` | No | Connected Instantly sender (`eaccount`) |
| `TWILIO_ACCOUNT_SID` | No | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | No | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | No | Twilio sending number (E.164) |

`npm run dev` unsets Twilio env vars in the dev script to avoid accidental SMS in local dev.

## Run locally

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase keys + APP_URL
supabase link --project-ref <ref>  # optional
supabase db push                   # apply migrations (see Database section below)
npm run dev
```

Open `http://localhost:3000` → sign up → create a tenant (onboarding) → board loads with seeded columns.

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`.

## Repository layout

```
app/
  (auth)/login, signup          Auth UI
  onboarding/                   Create / join tenant
  (app)/board, customers, settings/   Authenticated app shell
  respond/[token]/              Public customer notification page
  approve/[token]/              Legacy public approval page
  api/                          Server route handlers (mutations)
components/board/               Kanban UI
components/notify/              Missing info + approval send popups
lib/                            Business logic, Supabase clients, email/SMS
supabase/migrations/            SQL migrations (0001–0028; no 0010)
proxy.ts                        Session middleware helper [see Known issues](#known-issues)
```

## Database overview (actual table names)

| Table | Stores |
| --- | --- |
| `tenants` | Print house workspaces |
| `profiles` | User display names (mirrors `auth.users`) |
| `memberships` | User ↔ tenant + `role` |
| `board_columns` | Kanban columns (pipeline stages) |
| `orders` | Print jobs / cards (**not** named `jobs`) |
| `customers` | Customer directory (auto-linked from orders) |
| `custom_fields` | Field definitions per tenant |
| `custom_field_values` | Per-order custom field values |
| `assets` | File metadata (bytes in Storage) |
| `job_notifications` | Customer missing-info / approval notifications |
| `approvals` | Legacy customer approval records |
| `automation_rules` | Column-move and notification automations |
| `activity_log` | Audit trail per order |

**Storage buckets:** `order-assets` (private), `column-images` (public).

See the [Database](#database) section below for full schema.

## Naming glossary (avoid confusion)

| Colloquial / prompt term | Actual in code/DB |
| --- | --- |
| Job | `orders` row, UI "order" |
| Board | `board_columns` (no `boards` table) |
| Notification | `job_notifications` |
| Members | `memberships` + `profiles` |
| job_history | `activity_log` |
| attachments | `assets` |
| comments | [not implemented as a table] |
| automation_settings | Stored in `automation_rules.config` |

## Multi-tenant architecture

- Every business row has `tenant_id`.
- Users join tenants via `memberships` with a `role` (`admin`, `preprod_owner`, `designer`, `account_manager`, `member` — extended roles may require `setup.sql`; see [Known issues](#known-issues)).
- **RLS** on all tables uses `is_tenant_member(tenant_id)` / `is_tenant_admin(tenant_id)`.
- Active tenant selected by cookie **`ppm_tenant`** (`lib/constants.ts` → `TENANT_COOKIE`).
- `getTenantContext()` (`lib/auth.ts`) resolves session user + active membership; used by API routes and app layout.
- Storage paths start with `{tenant_id}/` and policies check the first path segment.

## Key architectural decisions

1. **API routes for mutations** — Order moves, notifications, asset uploads, and automations go through `app/api/*` so server code can log activity and run rules atomically.
2. **Direct Supabase reads** — Board page loads data server-side; Realtime on `orders` triggers `router.refresh()`.
3. **Deferred file uploads on order edit** — Artwork and assets in the edit modal stay local until "Save changes" (see `card-detail-modal.tsx`).
4. **Customer-facing flow** — Primary path is `job_notifications` + `/respond/[token]`; legacy `approvals` + `/approve/[token]` still exists.
5. **Customers are derived** — No manual customer CRUD; customers upsert from order custom fields (`lib/customers.ts`).
6. **Service role for public tokens** — `createAdminClient()` validates notification/approval tokens and serves gated asset downloads.

## What's NOT done / limitations

- No `comments` table or in-app commenting.
- Realtime only subscribes to **`orders`**, not `job_notifications` (board refreshes on order changes).
- `createApprovalForOrder()` (legacy `approvals` table) is **defined but unused** by the main board flow.
- Customer API routes (`/api/customers/*`) intentionally return 403.
- Migration `0010` is missing (jumps 0009 → 0011); some schema only in `setup.sql` may not apply via `db push` alone.
- `proxy.ts` exists for session refresh; there is **no root `middleware.ts`** — auth also enforced in layouts/pages.
- Email/SMS require external accounts; without them, operators must copy links from logs or the UI.

## Rules for AI agents extending this codebase

- Match existing patterns in `components/board/` and `lib/`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
- Respect RLS: use server `createClient()` for tenant-scoped data; `createAdminClient()` only after token or membership checks.
- Order terminology: DB table is `orders`; notification table is `job_notifications`.
- Run `npm run typecheck` after substantive changes.
- Do not invent tables or routes — verify in `supabase/migrations/` and `app/api/`.

---

## Architecture

**Last updated: June 23, 2026**

## High-level diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Staff UI    │────▶│ Next.js API      │────▶│ Supabase        │
│ (board,     │     │ routes + Server  │     │ Postgres + RLS  │
│  settings)  │◀────│ Components       │◀────│ Storage         │
└─────────────┘     └──────────────────┘     └─────────────────┘
       │                      │                        │
       │ Realtime             │ Instantly / Twilio     │
       │ (orders)             ▼                        │
       │               ┌──────────────┐                │
       └──────────────▶│ Customer     │◀───────────────┘
                       │ /respond/    │  token RPCs +
                       │ [token]      │  asset download
                       └──────────────┘
```

## Production pipeline (default columns)

Columns are tenant-configurable (`board_columns`). Default seed (`0001_init.sql`):

| Order (typical) | Column name | `kind` | Role |
| --- | --- | --- | --- |
| 1 | In Progress | `normal` | Active production |
| 2 | Missing Info | `missing_info` | Triggers missing-info notification popup on drop |
| 3 | Returning Tickets | `exception` | Rejection destination (approval flow) |
| 4 | Customer Approval | `approval` | Triggers approval notification popup |
| 5 | Done | `normal` | Completed |

**Flow:**

```
Order Created (In Progress)
    │
    ├─▶ drag to Missing Info
    │       └─▶ NotifyPopup → Email/SMS/Manual → customer /respond/[token]
    │               └─▶ customer submits → moves per automation rule or "Customer Replied" column*
    │
    ├─▶ drag to Customer Approval Request
    │       └─▶ ApprovalPopup → customer approves/rejects on /respond/[token]
    │               ├─▶ Approved → column from automation rule (often Done)
    │               └─▶ Not approved → stays; rejection logged in activity
    │
    └─▶ drag to Done
```

Column `kind` drives popup behavior in `components/board/board.tsx` (`onDragEnd`).

## Notification system

### Trigger

1. User drags an order into a column with `kind = missing_info` or `kind = customer_approval`.
2. `Board` opens `MissingInfoPopup` or `ApprovalPopup` (does not complete the move until send or cancel).
3. Operator picks channel: **email**, **sms**, or **manual** (link only).

### Send path

`POST /api/notifications/send` (`lib/notifications.ts` → `sendNotification`):

1. Creates `job_notifications` row with unique `token`, optional `token_expires_at`.
2. Builds customer URL: `{NEXT_PUBLIC_APP_URL}/respond/{token}`.
3. Sends via Instantly (`lib/email.ts`) or Twilio (`lib/sms.ts`), or logs URL if unconfigured.
4. Logs `activity_log` entry (`notification_sent`).
5. Order **stays** in the trigger column until the customer responds (move happens in `respondToNotification`).

### Customer response

1. Customer opens `/respond/[token]` — server calls RPC `get_notification_by_token` (no auth).
2. Page shows order summary (`OrderReview`) and form (`RespondForm`).
3. Customer can attach files (uploaded to `order-assets`, linked via `assets.notification_id`).
4. `POST /api/notifications/respond` → `respondToNotification`:
   - Validates token, expiry, duplicate response.
   - **Missing info:** moves order to rule target column (or column named "Customer Replied" if it exists).

\* Default `create_tenant` seed does **not** include a "Customer Replied" column — configure a notify rule target in Automations or add/rename a column. See [Known issues](#known-issues).
   - **Approval:** `approved` → `onApprovalResult`; `rejected` → activity log only.
   - Marks notification `status = responded`.

### Board update

`components/board/board.tsx` subscribes to Supabase Realtime on `orders` filtered by `tenant_id`. On any change → `router.refresh()` reloads server-rendered board data.

`job_notifications` is **not** subscribed; staff see notification state in the order detail modal tabs.

## Supabase Realtime

| Table | Subscribed? | Events | Handler |
| --- | --- | --- | --- |
| `orders` | Yes | `*` | `router.refresh()` in `Board` |
| Others | No | — | — |

Enable Realtime for `orders` in Supabase Dashboard → Database → Replication.

## Authentication

### Supabase Auth

- Email/password sign-up and login (`app/(auth)/login`, `signup`).
- Session stored in cookies via `@supabase/ssr` (`lib/supabase/server.ts`, `client.ts`).

### Session refresh

`lib/supabase/middleware.ts` exports `updateSession()` — refreshes auth cookies and redirects unauthenticated users away from protected paths.

`proxy.ts` at repo root re-exports this logic. **[TODO: verify]** whether Next.js 16 wires `proxy.ts` automatically; there is no `middleware.ts` at root. Auth is also enforced in:

- `app/(app)/layout.tsx` → `getTenantContext()` or redirect `/onboarding`
- `app/page.tsx` → redirect `/login` or `/board`
- Each API route → `getTenantContext()` → 401 if missing

### Team invites

1. Admin: `POST /api/team/invite` with email + role.
2. `supabase.auth.admin.generateLink({ type: "invite" })` + Instantly email.
3. Invitee sets password, logs in, joins tenant via `memberships` insert on accept flow.

### Roles

Defined in `lib/types.ts` → `MemberRole`. Permissions enforced in API routes (e.g. only `admin` can invite, delete orders, manage automations).

## Multi-tenancy

### Data isolation

- `tenant_id` on all tenant-scoped tables.
- RLS policies call `is_tenant_member(tenant_id)` for SELECT/INSERT/UPDATE/DELETE.
- Admin-only operations use `is_tenant_admin(tenant_id)`.

### Tenant selection

- Cookie `ppm_tenant` holds active tenant UUID.
- `getTenantContext()` reads cookie, validates membership, returns `{ tenant, role, memberships, email }`.
- `POST /api/tenant/switch` updates cookie when user has multiple tenants.

### Public (unauthenticated) access

- `/respond/[token]`, `/approve/[token]` — RPC functions with `security definer` validate token.
- `/api/notifications/respond`, `/api/notifications/asset` — service role after token check.

## Storage

| Bucket | Public? | Path pattern | Purpose |
| --- | --- | --- | --- |
| `order-assets` | No | `{tenant_id}/{order_id}/...` or `.../sku-{skuKey}/...` | Artwork, customer reply uploads |
| `column-images` | Yes | `{tenant_id}/{column_id}/...` | Column header images |

Signed URLs generated server-side for staff and token-gated download for customers (`/api/notifications/asset`).

## API routes (summary)

Full reference: [API routes](#api-routes).

| Area | Routes |
| --- | --- |
| Orders | `GET/POST /api/orders`, `PATCH/DELETE /api/orders/[id]`, `POST .../move` |
| Assets | `POST /api/assets`, `DELETE /api/assets/[id]` |
| Notifications | `POST /api/notifications/send`, `respond`, `asset`, `comment` |
| Customers | `GET /api/customers` (403), `POST .../link` |
| Automations | `GET/POST /api/automations`, `PATCH/DELETE .../[id]` |
| Notification rules | `GET/POST /api/notification-rules`, `PATCH/DELETE .../[id]` |
| Button automations | `GET/POST /api/button-automations`, `PATCH/DELETE .../[id]`, `POST .../reorder` |
| Fast action buttons | `GET/POST /api/fast-action-buttons`, `PATCH/DELETE .../[id]`, `POST .../[id]/trigger` |
| Columns | `GET/POST /api/columns`, `PATCH/DELETE .../[id]`, `POST .../reorder` |
| Custom fields | `GET/POST /api/fields`, `PATCH/DELETE .../[id]` |
| Analytics | `GET /api/analytics` |
| Team | `GET /api/team`, `POST .../invite`, `PATCH/DELETE .../[id]` |
| Tenant | `POST /api/tenant/switch`, `POST /api/onboarding` |
| Auth | `POST /api/auth/signout` |

## Legacy approval system

Parallel to `job_notifications`:

- Table `approvals` with `/approve/[token]` page.
- `createApprovalForOrder()` in `lib/automation.ts` sends legacy approval emails.
- **Current board flow uses `job_notifications` only**; legacy path remains for older data / RPC `get_approval_by_token`.

## Key source files

| Concern | File |
| --- | --- |
| Tenant context | `lib/auth.ts` |
| Order CRUD + move | `lib/orders.ts`, `app/api/orders/*` |
| Notifications | `lib/notifications.ts` |
| Automations | `lib/automation.ts` |
| Notification rules (auto email/SMS on move) | `lib/notification-rules.ts`, `lib/fire-notification-rules.ts` |
| Button automations | `lib/button-automations.ts`, `lib/button-automations.server.ts` |
| Fast action buttons | `lib/fast-action-buttons.ts`, `lib/fast-action-buttons.server.ts` |
| Drop permissions | `lib/permissions.ts`, `lib/columns.ts` |
| Column visibility | `lib/check-visibility.ts` |
| Email / SMS | `lib/email.ts`, `lib/sms.ts` |
| Board + DnD | `components/board/board.tsx` |
| Types | `lib/types.ts` |

---

## Database

**Last updated: June 23, 2026**

Source of truth: `supabase/migrations/` (applied via `supabase db push`) and `supabase/setup.sql` (full manual bootstrap). Some columns exist only in `setup.sql` — see [Known schema drift](#known-schema-drift).

## Enums

| Enum | Values |
| --- | --- |
| `member_role` | `admin`, `member` (+ extended roles in app types; may need manual SQL — see KNOWN_ISSUES) |
| `column_kind` | `normal`, `exception`, `approval`, `done` |
| `order_priority` | `low`, `normal`, `high`, `urgent` |
| `custom_field_type` | `text`, `number`, `select`, `date`, `checkbox` |
| `approval_status` | `pending`, `approved`, `rejected` |
| `automation_trigger` | `on_enter_column`, `on_approval_result` |
| `notification_type` | `missing_info`, `customer_approval` |
| `notification_channel` | `email`, `sms`, `none`, `manual` |
| `notification_status` | `pending`, `sent`, `responded`, `expired` |

## Tables

### `tenants`

**Purpose:** One row per print house / workspace.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Tenant ID |
| `name` | `text` | Display name |
| `slug` | `text` UNIQUE | URL-safe identifier |
| `created_at` | `timestamptz` | Created timestamp |

**FKs:** None (root entity).

**RLS:** Members can SELECT; admins can UPDATE.

**Example:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Bazaar Printing",
  "slug": "bazaar-printing",
  "created_at": "2026-01-15T10:00:00Z"
}
```

---

### `profiles`

**Purpose:** App profile for each `auth.users` row (display name, avatar).

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Same as `auth.users.id` |
| `full_name` | `text` | Display name |
| `avatar_url` | `text` | Optional avatar URL |
| `created_at` | `timestamptz` | Created timestamp |

**FKs:** `id` → `auth.users(id)` ON DELETE CASCADE.

**RLS:** SELECT self or teammates; UPDATE/INSERT self only.

---

### `memberships`

**Purpose:** Links users to tenants with a role. *(Prompt alias: team membership table.)*

| Column | Type | Description |
| --- | --- | --- |
| `user_id` | `uuid` PK (composite) | User |
| `tenant_id` | `uuid` PK (composite) | Tenant |
| `role` | `member_role` | `admin` or `member` (app may use extended roles) |
| `created_at` | `timestamptz` | Joined at |

**FKs:** `user_id` → `auth.users`; `tenant_id` → `tenants`.

**RLS:** Members SELECT; admins ALL.

**Example:**

```json
{
  "user_id": "user-uuid",
  "tenant_id": "tenant-uuid",
  "role": "admin",
  "created_at": "2026-01-15T10:01:00Z"
}
```

---

### `board_columns`

**Purpose:** Kanban pipeline stages. *(No separate `boards` table — one board per tenant.)*

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Column ID |
| `tenant_id` | `uuid` | Owning tenant |
| `name` | `text` | Column label |
| `position` | `int` | Sort order (left → right) |
| `kind` | `column_kind` | `exception` → missing-info popup; `approval` → approval popup |
| `color` | `text` | Optional hex color (migration `0004`) |
| `image_url` | `text` | Optional header image URL |
| `drop_in_roles` | `member_role[]` | Who may drop cards **into** column (`setup.sql` only) |
| `drop_out_roles` | `member_role[]` | Who may drag cards **out** (`setup.sql` only) |
| `created_at` | `timestamptz` | Created timestamp |

**FKs:** `tenant_id` → `tenants`.

**RLS:** Members SELECT; admins ALL.

**Example:**

```json
{
  "id": "col-uuid",
  "tenant_id": "tenant-uuid",
  "name": "Missing Info",
  "position": 2,
  "kind": "exception",
  "color": "#f59e0b",
  "image_url": null
}
```

---

### `orders`

**Purpose:** Print jobs / Kanban cards. *(Prompt alias: `jobs`.)*

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Order ID |
| `tenant_id` | `uuid` | Tenant |
| `column_id` | `uuid` | Current column |
| `customer_id` | `uuid` | Linked customer (nullable) |
| `title` | `text` | Order title / number |
| `description` | `text` | Free text |
| `specs` | `jsonb` | Structured data (SKUs in `specs.skus[]`) |
| `priority` | `order_priority` | Priority badge |
| `due_date` | `date` | Due date |
| `position` | `double precision` | Sort within column |
| `created_by` | `uuid` | Creator user |
| `created_at` | `timestamptz` | Created |
| `updated_at` | `timestamptz` | Auto-updated on change |

**FKs:** `tenant_id` → `tenants`; `column_id` → `board_columns`; `customer_id` → `customers`; `created_by` → `auth.users`.

**RLS:** Tenant members ALL.

**Example:**

```json
{
  "id": "order-uuid",
  "tenant_id": "tenant-uuid",
  "column_id": "col-uuid",
  "customer_id": "customer-uuid",
  "title": "PO-1042",
  "description": "Business cards",
  "specs": { "skus": [{ "id": "sku-1", "name": "4x6", "qty": 500 }] },
  "priority": "normal",
  "due_date": "2026-06-15",
  "position": 2000,
  "created_by": "user-uuid",
  "created_at": "2026-06-01T09:00:00Z",
  "updated_at": "2026-06-01T09:00:00Z"
}
```

---

### `customers`

**Purpose:** Customer directory; auto-upserted from order custom fields.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Customer ID |
| `tenant_id` | `uuid` | Tenant |
| `name` | `text` | Customer name |
| `email` | `text` | Email (unique per tenant when set) |
| `phone` | `text` | Phone (unique per tenant when set) |
| `company` | `text` | Company name |
| `created_at` | `timestamptz` | Created |
| `updated_at` | `timestamptz` | Auto-updated (migration `0012`) |

**FKs:** `tenant_id` → `tenants`.

**RLS:** Tenant members ALL.

---

### `custom_fields`

**Purpose:** Tenant-defined field definitions for orders.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Field ID |
| `tenant_id` | `uuid` | Tenant |
| `name` | `text` | Label (e.g. "Customer Contact") |
| `field_type` | `custom_field_type` | Input type |
| `options` | `jsonb` | Select options array |
| `position` | `int` | Form order |
| `required` | `boolean` | Required on create (migration `0005`) |
| `created_at` | `timestamptz` | Created |

**FKs:** `tenant_id` → `tenants`.

**RLS:** Members SELECT; admins ALL.

---

### `custom_field_values`

**Purpose:** Per-order values for custom fields.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Row ID |
| `order_id` | `uuid` | Order |
| `custom_field_id` | `uuid` | Field definition |
| `value` | `jsonb` | Stored value |

**FKs:** `order_id` → `orders`; `custom_field_id` → `custom_fields`. UNIQUE (`order_id`, `custom_field_id`).

**RLS:** Members of the order's tenant ALL.

---

### `assets`

**Purpose:** File metadata for order artwork and customer uploads. *(Prompt alias: `attachments`.)*

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Asset ID |
| `tenant_id` | `uuid` | Tenant |
| `order_id` | `uuid` | Parent order |
| `sku_key` | `text` | Links to `specs.skus[].id` (`setup.sql` only — not in migrations) |
| `notification_id` | `uuid` | Customer reply upload link (nullable) |
| `file_name` | `text` | Original filename |
| `storage_path` | `text` | Path in `order-assets` bucket |
| `mime_type` | `text` | MIME type |
| `size` | `bigint` | Bytes |
| `uploaded_by` | `uuid` | Uploader (null for customer) |
| `created_at` | `timestamptz` | Uploaded at |

**FKs:** `tenant_id` → `tenants`; `order_id` → `orders`; `notification_id` → `job_notifications`.

**RLS:** Tenant members ALL.

**Storage path:** `{tenant_id}/{order_id}/{filename}` or `{tenant_id}/{order_id}/sku-{skuKey}/{filename}`.

---

### `job_notifications`

**Purpose:** Customer missing-info and approval notifications with tokenized links.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Notification ID |
| `tenant_id` | `uuid` | Tenant |
| `order_id` | `uuid` | Order |
| `type` | `notification_type` | `missing_info` or `customer_approval` |
| `channel` | `notification_channel` | How it was sent |
| `token` | `uuid` UNIQUE | Public URL token |
| `token_expires_at` | `timestamptz` | Optional expiry |
| `status` | `notification_status` | Lifecycle state |
| `staff_note` | `text` | Note from operator when sending |
| `customer_response` | `text` | `approved`, `changes_requested`, `info_submitted` |
| `customer_note` | `text` | Customer free text |
| `responded_at` | `timestamptz` | When customer responded |
| `created_by` | `uuid` | Staff sender |
| `created_at` | `timestamptz` | Created |

**FKs:** `tenant_id` → `tenants`; `order_id` → `orders`.

**RLS:** Tenant members ALL. Public read via RPC `get_notification_by_token`.

---

### `approvals` (legacy)

**Purpose:** Older customer approval flow (`/approve/[token]`). Main board uses `job_notifications`.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Approval ID |
| `tenant_id` | `uuid` | Tenant |
| `order_id` | `uuid` | Order |
| `status` | `approval_status` | `pending`, `approved`, `rejected` |
| `token` | `uuid` UNIQUE | Public token |
| `customer_email` | `text` | Email used |
| `comment` | `text` | Customer comment |
| `decided_at` | `timestamptz` | Decision time |
| `created_at` | `timestamptz` | Created |

**RLS:** Tenant members ALL. Public via `get_approval_by_token` RPC.

---

### `automation_rules`

**Purpose:** Column moves and notification triggers. *(No separate `automation_settings` table — config in `config` jsonb.)*

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Rule ID |
| `tenant_id` | `uuid` | Tenant |
| `trigger` | `automation_trigger` | When rule runs |
| `from_column` | `uuid` | Source column (nullable) |
| `to_column` | `uuid` | Target column (nullable) |
| `config` | `jsonb` | e.g. `{ "action": "notify", "notify_type": "missing_info" }` or `{ "result": "approved" }` |
| `enabled` | `boolean` | Active flag |
| `created_at` | `timestamptz` | Created |

**FKs:** `tenant_id` → `tenants`; column FKs → `board_columns`.

**RLS:** Members SELECT; admins ALL.

---

### `activity_log`

**Purpose:** Audit trail per order. *(Prompt alias: `job_history`.)*

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Log entry ID |
| `tenant_id` | `uuid` | Tenant |
| `order_id` | `uuid` | Order (nullable) |
| `actor` | `uuid` | User who acted (null = customer/system) |
| `action` | `text` | e.g. `moved`, `notification_sent`, `rejected` |
| `metadata` | `jsonb` | Extra context |
| `created_at` | `timestamptz` | When |

**FKs:** `tenant_id` → `tenants`; `order_id` → `orders`; `actor` → `auth.users`.

**RLS:** Tenant members SELECT; members INSERT; admins DELETE.

---

### `notification_rules`

**Purpose:** Automated email/SMS messages fired whenever an order card moves into a configured column. Set up in Settings → Button Automation → Notification Rules.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Rule ID |
| `tenant_id` | `uuid` | Tenant |
| `name` | `text` | Human-readable rule name |
| `trigger` | `text` | `on_enter_column` or `on_job_created` |
| `column_id` | `uuid` nullable | Target column (null = fire on any column entry) |
| `send_email` | `boolean` | Send email? |
| `send_sms` | `boolean` | Send SMS? |
| `recipient` | `text` | `customer`, `staff`, or `both` |
| `email_subject` | `text` | Handlebars template for subject |
| `email_body` | `text` | Handlebars template for body |
| `sms_body` | `text` | Handlebars template for SMS |
| `sms_to_phone` | `text` | Fixed phone number override (empty = use customer/staff phone from order) |
| `enabled` | `boolean` | Active flag |
| `position` | `integer` | Display/execution order |
| `created_at` | `timestamptz` | Created |

**Template variables:** `{{order_number}}`, `{{customer_name}}`, `{{column_name}}`, `{{due_date}}`, `{{product}}`, `{{tenant_name}}`.

**FKs:** `tenant_id` → `tenants`; `column_id` → `board_columns`.

**RLS:** Members SELECT; admins ALL.

**Fire path:** `POST /api/orders/move` → `fireNotificationRules()` in `lib/fire-notification-rules.ts` (async, non-blocking).

---

### `button_automations`

**Purpose:** Fast-action buttons visible on job cards, triggering PDF generation, column moves, notifications, or custom webhooks.

| Column | Type | Description |
| --- | --- | --- |
| `id` | `uuid` PK | Button ID |
| `tenant_id` | `uuid` | Tenant |
| `name` | `text` | Button label |
| `action_type` | `text` | e.g. `pdf`, `move`, `notify`, `webhook` |
| `config` | `jsonb` | Action-specific config |
| `enabled` | `boolean` | Active flag |
| `position` | `integer` | Display order |
| `created_at` | `timestamptz` | Created |

**FKs:** `tenant_id` → `tenants`.

**RLS:** Members SELECT; admins ALL.

**Fire path:** `POST /api/fast-action-buttons/[id]/trigger` → server action.

---

## Tables NOT in this project

| Prompt name | Status |
| --- | --- |
| `boards` | Not used — columns are tenant-scoped |
| `jobs` | Use `orders` |
| `attachments` | Use `assets` |
| `job_history` | Use `activity_log` |
| `comments` | Not implemented |
| `automation_settings` | Stored in `automation_rules.config` |

## SQL helper functions

| Function | Purpose |
| --- | --- |
| `is_tenant_member(uuid)` | RLS membership check |
| `is_tenant_admin(uuid)` | Admin check |
| `create_tenant(name, slug)` | Onboarding: tenant + default columns + automations |
| `get_notification_by_token(uuid)` | Public notification + order data for `/respond` |
| `get_approval_by_token(uuid)` | Public approval + order data for `/approve` |
| `handle_new_user()` | Trigger: create `profiles` on signup |

## Storage buckets

| Bucket | Public | RLS |
| --- | --- | --- |
| `order-assets` | No | Tenant member via path prefix |
| `column-images` | Yes | Member insert/delete |

## Migrations list

| File | Contents |
| --- | --- |
| `0001_schema.sql` | Core tables |
| `0002_functions.sql` | Helpers, `create_tenant`, approval RPCs |
| `0003_rls.sql` | RLS policies |
| `0004_board_columns_meta.sql` | Column color/image, `column-images` bucket |
| `0005_custom_field_required.sql` | `custom_fields.required` |
| `0006_job_notifications.sql` | `job_notifications`, asset link |
| `0007_customers_unique.sql` | Unique email/phone per tenant |
| `0008_notification_rpc_fields.sql` | Extended RPC fields |
| `0009_notification_channel_manual.sql` | `manual` channel enum |
| `0011_respond_order_assets.sql` | `order_id`, `order_fields` in token RPCs |
| `0012_customers_updated_at.sql` | `customers.updated_at` + trigger |
| `0013_*` – `0022_*` | Various incremental changes (see file headers) |
| `0023_notification_rules.sql` | `notification_rules` table + RLS |
| `0024_fast_action_buttons.sql` | `button_automations` table + RLS |
| `0025_column_visibility.sql` | Column visibility fields (`visible_to_roles`, etc.) on `board_columns` |
| `0026_role_or_individual_picker.sql` | Support tables/columns for role-or-individual targeting |
| `0027_notification_rule_trigger.sql` | `trigger` column on `notification_rules` |
| `0028_notification_rule_sms_phone.sql` | `sms_to_phone` column on `notification_rules` |

**Note:** There is no `0010_*.sql` in the repo. `sku_key`, `drop_in_roles`, and extended `member_role` values are in `setup.sql` only.

## Known schema drift

If `sku_key` or `drop_in_roles` errors appear at runtime, apply the relevant sections from `supabase/setup.sql` manually and reload the PostgREST schema cache in Supabase Dashboard.

---

## API routes

**Last updated: June 23, 2026**

All authenticated routes require a valid Supabase session and active tenant (`getTenantContext()`). Missing session → **401**. Wrong tenant / not found → **404** or **403** as noted.

Base URL: `{NEXT_PUBLIC_APP_URL}/api`

---

## Orders

### `POST /api/orders`

Create a new order.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | `{ title, description?, columnId?, priority?, dueDate?, specs?, customFieldValues?: [{ customFieldId, value }] }` |
| **Response** | `{ order }` |
| **Errors** | 400 missing title / invalid due date / invalid column; 401 |

### `GET /api/orders/[id]`

Full order detail: order, custom field values, assets, notifications, activity.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Response** | `{ order, customFields, fieldValues, assets, notifications, activity }` |
| **Errors** | 404 |

### `PATCH /api/orders/[id]`

Update order fields, specs, custom values, customer link.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | Partial order + `customFieldValues`, `specs` |
| **Response** | `{ order }` |
| **Errors** | 400 validation; 404 |

### `DELETE /api/orders/[id]`

Delete order (admin only).

| | |
| --- | --- |
| **Auth** | Session + tenant, admin role |
| **Response** | `{ ok: true }` |
| **Errors** | 403; 404 |

### `POST /api/orders/move`

Move order to column + position; runs `onEnterColumn` automations.

| | |
| --- | --- |
| **Auth** | Session + tenant; column drop permissions checked |
| **Body** | `{ orderId, toColumnId, position }` |
| **Response** | `{ ok: true }` |
| **Errors** | 400 / 403 permission denied; 404 |

---

## Assets

### `POST /api/assets/upload`

Upload file to `order-assets` bucket; creates `assets` row.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | `multipart/form-data`: `file`, `orderId`, optional `skuKey` |
| **Response** | `{ asset }` |
| **Errors** | 400 / 404 |

### `GET /api/assets/[id]`

Redirect to signed download URL.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Response** | 302 redirect |
| **Errors** | 404 |

### `DELETE /api/assets/[id]`

Delete asset from storage + DB.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Response** | `{ ok: true }` |
| **Errors** | 404 |

---

## Notifications

### `POST /api/notifications/send`

Create notification, send email/SMS, return customer link.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | `{ orderId, type: "missing_info" \| "customer_approval", channel: "email" \| "sms" \| "manual" \| "none", staffNote?, toEmail?, toPhone?, subject?, messageBody? }` |
| **Response** | `{ ok: true, channel, token, actionUrl }` |
| **Errors** | 400 send failure; 404 order |

### `POST /api/notifications/save`

Save draft notification without sending (staff note only).

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | `{ orderId, type, staffNote? }` |
| **Response** | `{ notification }` |

### `POST /api/notifications/[id]/send`

Resend an existing notification.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | `{ channel, toEmail?, toPhone?, ... }` |
| **Response** | `{ ok: true, actionUrl }` |

### `PATCH /api/notifications/[id]`

Update staff note on a notification.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | `{ staffNote }` |
| **Response** | `{ notification }` |

### `DELETE /api/notifications/[id]`

Delete a notification record.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Response** | `{ ok: true }` |

### `POST /api/notifications/[id]/manual-approve`

Staff manually marks customer approval as approved (moves card).

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Body** | (empty) |
| **Response** | `{ ok: true }` |
| **Errors** | 400 if not `customer_approval` type |

### `POST /api/notifications/respond`

**Public** — customer submits response via token.

| | |
| --- | --- |
| **Auth** | None (token in body); uses service role server-side |
| **Body** | `{ token, response: "approved" \| "changes_requested" \| "info_submitted", note? }` |
| **Response** | `{ ok: true }` |
| **Errors** | 400 validation; 404 invalid token; 409 already responded; 410 expired |

### `POST /api/notifications/upload`

**Public** — customer uploads file for missing-info response.

| | |
| --- | --- |
| **Auth** | Token in form (`token` field) |
| **Body** | `multipart/form-data`: `file`, `token` |
| **Response** | `{ asset }` |
| **Errors** | 400 wrong type; 404 invalid token |

### `GET /api/notifications/asset`

**Public** — download asset gated by notification or approval token.

| | |
| --- | --- |
| **Auth** | Query `?token=...&assetId=...` |
| **Response** | File stream / redirect |
| **Errors** | 403 / 404 |

---

## Approvals (legacy)

### `POST /api/approvals/decide`

**Public** — legacy `/approve/[token]` decision.

| | |
| --- | --- |
| **Auth** | Token in body |
| **Body** | `{ token, decision: "approved" \| "rejected", comment? }` |
| **Response** | `{ ok: true }` |

---

## Columns

### `POST /api/columns`

Create column (admin).

| | |
| --- | --- |
| **Body** | `{ name, kind?, color? }` |
| **Response** | `{ column }` |

### `PATCH /api/columns/[id]`

Update column name, kind, color, drop roles.

### `DELETE /api/columns/[id]`

Delete column (must be empty).

### `POST /api/columns/reorder`

| | |
| --- | --- |
| **Body** | `{ columnIds: string[] }` |
| **Response** | `{ ok: true }` |

### `POST /api/columns/image`

Upload column header image to `column-images` bucket.

| | |
| --- | --- |
| **Body** | `multipart/form-data`: `file`, `columnId` |
| **Response** | `{ imageUrl }` |

---

## Custom fields

### `POST /api/custom-fields`

Create field definition (admin).

### `PATCH /api/custom-fields/[id]`

Update field.

### `DELETE /api/custom-fields/[id]`

Delete field.

### `POST /api/custom-fields/seed-defaults`

Seed default field set for tenant (admin).

---

## Automations

### `POST /api/automations`

Create automation rule (admin).

| | |
| --- | --- |
| **Body** | `{ trigger, fromColumn?, toColumn?, config, enabled? }` |

### `PATCH /api/automations/[id]`

Update rule.

### `DELETE /api/automations/[id]`

Delete rule.

---

## Notification rules

Admin-only. Manages `notification_rules` rows.

### `GET /api/notification-rules`

List all rules for active tenant (ordered by `position`).

| | |
| --- | --- |
| **Auth** | Session + tenant; admin required |
| **Response** | `{ rules: NotificationRule[], migrationPending: boolean }` |

`migrationPending: true` means the `notification_rules` table has not yet been created; UI shows a warning.

### `POST /api/notification-rules`

Create rule.

| | |
| --- | --- |
| **Body** | `{ name, trigger, column_id?, send_email, send_sms, recipient, email_subject, email_body, sms_body, sms_to_phone?, enabled? }` |
| **Response** | `{ rule: NotificationRule }` |
| **Errors** | 400 invalid fields; 503 migration pending |

### `PATCH /api/notification-rules/[id]`

Update rule (partial).

### `DELETE /api/notification-rules/[id]`

Delete rule.

---

## Fast action buttons

Admin-only. Manages `button_automations` rows.

### `GET /api/fast-action-buttons`

List all buttons for active tenant.

| | |
| --- | --- |
| **Response** | `{ buttons: ButtonAutomation[], migrationPending: boolean }` |

### `POST /api/fast-action-buttons`

Create button.

### `PATCH /api/fast-action-buttons/[id]`

Update button.

### `DELETE /api/fast-action-buttons/[id]`

Delete button.

### `POST /api/fast-action-buttons/[id]/trigger`

Trigger a button action on a given order.

| | |
| --- | --- |
| **Body** | `{ orderId }` |
| **Response** | `{ ok: true }` |
| **Errors** | 400 / 404 / 500 |

---

## Analytics

### `GET /api/analytics`

Return aggregated order throughput, column dwell times, and staff performance metrics.

| | |
| --- | --- |
| **Auth** | Session + tenant; admin required |
| **Query params** | `range` (`7d`, `30d`, `90d`), optional `staffId` |
| **Response** | `{ throughput, dwellTimes, staffMetrics }` |

---

## Team / members

### `GET /api/members`

List team members + pending invites for active tenant.

| | |
| --- | --- |
| **Auth** | Session + tenant |
| **Response** | `{ members: TeamMemberRow[] }` |

### `POST /api/members`

Invite teammate (admin).

| | |
| --- | --- |
| **Body** | `{ email, role, fullName? }` |
| **Response** | `{ ok: true, emailSent?, inviteUrl? }` |
| **Errors** | 400 / 500 if service role missing |

### `PATCH /api/members/[userId]`

Change member role (admin).

### `DELETE /api/members/[userId]`

Remove member or revoke pending invite (admin).

---

## Customers

### `POST /api/customers`

Returns **403** — customers are auto-managed from orders.

### `PATCH /api/customers/[id]`

Returns **403**.

### `DELETE /api/customers/[id]`

Returns **403**.

---

## Tenant

### `POST /api/tenants`

Create new tenant (onboarding). Calls `create_tenant` RPC.

| | |
| --- | --- |
| **Auth** | Session (no tenant required) |
| **Body** | `{ name, slug }` |
| **Response** | `{ tenant }` |

### `POST /api/tenant/switch`

Switch active tenant cookie.

| | |
| --- | --- |
| **Body** | `{ tenantId }` |
| **Response** | `{ ok: true }` |
| **Errors** | 403 if not a member |

---

## Error response shape

Most routes return JSON:

```json
{ "error": "Human-readable message" }
```

Success responses vary by route; common patterns: `{ ok: true }`, `{ order }`, `{ members }`.

---

## Components

**Last updated: June 23, 2026**

Component paths are under `components/` unless noted. User-prompt names are mapped to actual file names.

## Board (Kanban)

### `Board` — `components/board/board.tsx`

*(Prompt alias: KanbanBoard)*

Main production board: drag-and-drop, filters, modals, notification popups, Realtime refresh.

| Prop | Type | Description |
| --- | --- | --- |
| `tenantId` | `string` | Active tenant |
| `tenantName` | `string` | For notification emails |
| `role` | `Role` | Current user role (drop permissions) |
| `columns` | `BoardColumn[]` | Pipeline columns |
| `initialOrders` | `OrderWithRelations[]` | Orders with customer join |
| `customFields` | `CustomField[]` | Field definitions |
| `fieldValuesByOrder` | `Record<string, Record<string, unknown>>` | Values keyed by order ID |
| `thumbnailByOrder` | `Record<string, string>` | Signed image URLs |
| `designers` | `Designer[]` | For person filter |
| `notifyRules` | `{ from_column, notify_type }[]` | Enabled notify automations |
| `notificationBadgeByOrder` | `Record<string, CardNotificationBadge>` | Card badges |
| `ownerNameByOrder` | `Record<string, string>` | Designer name on card |
| `smsConfigured` | `boolean` | Show SMS option |
| `publicAppUrl` | `boolean` | Warn if APP_URL is localhost |

**Depends on:** `Column`, `OrderCard`, `CreateOrderModal`, `CardDetailModal`, `NotificationPopup`, `@dnd-kit`, Supabase client (Realtime).

**Behavior:**

- `DndContext` handles drag between columns and reorder within column.
- On cross-column drop → `POST /api/orders/move`; may open `NotificationPopup`.
- Subscribes to `orders` Realtime → `router.refresh()`.
- Opens `CardDetailModal` when a card is clicked.

---

### `Column` — `components/board/column.tsx`

*(Prompt alias: KanbanColumn)*

Single Kanban column with droppable area and sortable order cards.

| Prop | Type | Description |
| --- | --- | --- |
| `column` | `BoardColumn` | Column metadata |
| `canDragOut` | `boolean` | Role-based drag-out permission |
| `orders` | `OrderWithRelations[]` | Cards in this column |
| `customFields`, `fieldValuesByOrder`, `thumbnailByOrder`, `notificationBadgeByOrder`, `ownerNameByOrder` | | Passed through to cards |
| `isFirst` | `boolean` | Layout tweak for first column |
| `onOpenOrder` | `(order) => void` | Card click handler |
| `onAdd` | `(columnId) => void` | "+" new order in column |

**Depends on:** `OrderCard`, `@dnd-kit` droppable/sortable.

---

### `OrderCard` — `components/board/order-card.tsx`

*(Prompt alias: Order card / job card)*

Draggable card showing order number, customer, contact, due date, priority, thumbnail, notification badge.

| Prop | Type | Description |
| --- | --- | --- |
| `order` | `OrderWithRelations` | Order + customer |
| `canDrag` | `boolean` | Enable drag (default true) |
| `customFields` | `CustomField[]` | For customer name resolution |
| `fieldValues` | `Record<string, unknown>` | Custom field values |
| `thumbnail` | `string` | Preview image URL |
| `notificationBadge` | `CardNotificationBadge` | e.g. "Rejected" |
| `ownerName` | `string` | Assigned designer |
| `onOpen` | `(order) => void` | Click to open detail |

**Depends on:** `@dnd-kit/sortable`, `Badge`, `lib/card-badges`, `lib/customer-name`.

**Features:** Bold order number and contact with click-to-copy.

---

### `CardDetailModal` — `components/board/card-detail-modal.tsx`

*(Prompt alias: OrderDetailsModal)*

Full order editor: form, SKUs, artwork, activity log, Missing Info tab, Approval tab.

| Prop | Type | Description |
| --- | --- | --- |
| `orderId` | `string \| null` | Order to load |
| `open` | `boolean` | Modal visibility |
| `onClose` | `() => void` | Close handler |
| `customFields` | `CustomField[]` | Form fields |
| `columns` | `BoardColumn[]` | Column picker |
| `designers` | `Designer[]` | Owner assignment |
| `role` | `Role` | Permissions |
| `onChanged` | `() => void` | Parent refresh after save |

**Depends on:** `OrderFormBody`, `SkuEditor`, `MissingInfoTab`, `ApprovalTab`, `Modal`, asset upload APIs.

**Behavior:** Deferred artwork upload — files stay pending until **Save changes**.

---

### `MissingInfoTab` — `components/board/missing-info-tab.tsx`

Staff UI inside order detail for missing-info notification history: resend, copy link, view customer uploads.

| Prop | Type | Description |
| --- | --- | --- |
| `notes` | `MissingInfoNote[]` | Notification records |
| `customer` | `Customer \| null` | Linked customer |
| `orderId` | `string` | Order ID |
| `columns` | `BoardColumn[]` | For context |
| `contactEmail`, `contactPhone` | `string?` | Override contacts |
| `onSent` | `() => void` | Refresh after send |

**Depends on:** `CustomerLinkRow`, notification API routes.

---

### `ApprovalTab` — `components/board/approval-tab.tsx`

Staff UI for customer approval notifications: status, resend, manual approve, rejection notes.

| Prop | Type | Description |
| --- | --- | --- |
| `notes` | `ApprovalNote[]` | Approval notifications |
| `legacyApprovals` | `Approval[]` | Legacy `approvals` table rows |
| `customer`, `orderId`, `columns`, `contactEmail`, `contactPhone`, `onSent` | | Same pattern as MissingInfoTab |

---

### Supporting board components

| Component | Path | Role |
| --- | --- | --- |
| `CreateOrderModal` | `create-order-modal.tsx` | New order form |
| `OrderFormBody` | `order-form-body.tsx` | Shared create/edit form |
| `SkuEditor` | `sku-editor.tsx` | SKU rows + qty |
| `SkuArtworkCell` | `sku-artwork-cell.tsx` | Per-SKU artwork thumbnail/upload |
| `CustomFieldInput` | `custom-field-input.tsx` | Renders one custom field |
| `CustomerLinkRow` | `customer-link-row.tsx` | Copy customer action URL |
| `OrderQtyField` | `order-qty-field.tsx` | Order quantity custom field |

---

## Notification popups

### `NotificationPopup` — `components/automation/notification-popup.tsx`

*(Prompt alias: NotifyPopup — router component)*

Routes to the correct popup by `type`; on dismiss saves `manual` channel notification.

| Prop | Type | Description |
| --- | --- | --- |
| `order` | `OrderWithRelations` | Order being notified |
| `columnName` | `string` | Target column name |
| `type` | `NotificationType` | `missing_info` or `customer_approval` |
| `tenantName` | `string` | Email branding |
| `customFields`, `fieldValues` | | Contact resolution |
| `smsConfigured`, `publicAppUrl` | `boolean` | UX warnings |
| `onClose` | `() => void` | Cancel / manual dismiss |
| `onSaved` | `(message) => void` | Success toast |

---

### `MissingInfoPopup` — `components/notify/MissingInfoPopup.tsx`

Operator popup after drop to exception column: staff note, channel (email/SMS/manual), read-only email preview.

**Depends on:** `POST /api/notifications/send`, `lib/notification-messages`.

---

### `ApprovalPopup` — `components/notify/ApprovalPopup.tsx`

Operator popup after drop to approval column: channel selection, optional note, sends approval request.

---

## Customer-facing pages

### `RespondPage` — `app/respond/[token]/page.tsx`

Public server page for `/respond/[token]`. Loads notification via `get_notification_by_token` RPC.

**Renders:** `OrderReview` (order details + SKUs + artwork) + `RespondForm` (submit response / upload).

**Depends on:** `lib/respond-order.ts`, `components/respond/order-review.tsx`.

---

### `OrderReview` — `components/respond/order-review.tsx`

Read-only order summary for customers: meta chips, SKU table, artwork grid with download links via `/api/notifications/asset`.

---

### `RespondForm` — `app/respond/[token]/respond-form.tsx`

Client form: note, file upload (`/api/notifications/upload`), approve / reject / submit info (`/api/notifications/respond`).

---

### `ApprovePage` — `app/approve/[token]/page.tsx`

Legacy approval page using `get_approval_by_token` RPC. Also shows `OrderReview`. Uses `/api/approvals/decide`.

---

## Settings pages

| Route | Manager component | Purpose |
| --- | --- | --- |
| `/settings/team` | `team-manager.tsx` | Invite members, change roles, revoke |
| `/settings/automations` | `automations-manager.tsx` | Notify rules + approval result moves |
| `/settings/fields` | `fields-manager.tsx` | Custom field CRUD |
| `/settings/columns` | `columns-manager.tsx` | Column CRUD, reorder, images, drop roles, visibility |
| `/settings/button-automation` | `fast-action-buttons-manager.tsx` + `notification-rules-manager.tsx` | Fast action buttons + column notification rules |

All settings live under `app/(app)/settings/` with shared `layout.tsx` (admin nav).

---

## App shell

| Component | Path | Role |
| --- | --- | --- |
| `Sidebar` | `app-shell/sidebar.tsx` | Nav links by role |
| `Topbar` | `app-shell/topbar.tsx` | Tenant switcher, user menu |
| `Providers` | `providers.tsx` | React Query provider |

---

## UI primitives

`components/ui/`: `button.tsx`, `input.tsx`, `modal.tsx`, `badge.tsx` — shared styled building blocks.

---

### `FastActionButtonBar` — `components/board/fast-action-button-bar.tsx`

Horizontal row of quick-action buttons rendered at the bottom of each job card (or in the card detail modal). Each button calls `POST /api/fast-action-buttons/[id]/trigger` with the current `orderId`.

| Prop | Type | Description |
| --- | --- | --- |
| `orderId` | `string` | Target order |
| `buttons` | `ButtonAutomation[]` | Enabled buttons for tenant |
| `onDone` | `() => void` | Callback after trigger succeeds |

---

### `NotificationRulesManager` — `app/(app)/settings/button-automation/notification-rules-manager.tsx`

Admin UI to create, edit, reorder, enable/disable, and delete column notification rules. Embeds the `RuleEditor` drawer for full-rule configuration.

Key UI sections:

- Rules list with column name, recipient badge, email/SMS toggles, enabled toggle, and edit/delete actions.
- `RuleEditor` drawer includes: name, trigger, target column, recipient, email subject/body, SMS body, and **Contact number** (`sms_to_phone`) for a fixed SMS override phone.

---

### `FastActionButtonsManager` — `app/(app)/settings/button-automation/fast-action-buttons-manager.tsx`

Admin UI to manage fast action buttons (create, edit, reorder, delete). Mirrors the layout of `NotificationRulesManager`.

---

### `RoleOrIndividualPicker` — `components/RoleOrIndividualPicker.tsx`

Reusable picker that lets the admin select either roles (e.g. `admin`, `designer`) or specific team members for permissions or recipient targeting.

---

## Component dependency graph (simplified)

```
BoardPage (server)
  └── Board
        ├── Column → OrderCard → FastActionButtonBar
        ├── CreateOrderModal → OrderFormBody → SkuEditor → SkuArtworkCell
        ├── CardDetailModal → MissingInfoTab, ApprovalTab, OrderFormBody
        └── NotificationPopup → MissingInfoPopup | ApprovalPopup

ButtonAutomationPage (server)
  ├── FastActionButtonsManager
  └── NotificationRulesManager → RuleEditor (drawer)

respond/[token]/page (server)
  ├── OrderReview
  └── RespondForm
```

---

## Workflows

**Last updated: June 23, 2026**

End-to-end flows as implemented in code. Column **kinds** in the database are `exception` (missing info) and `approval` (customer approval), not the string names `missing_info` / `customer_approval` (those are notification types).

---

## Missing Info workflow

### 1. Designer drops card to Missing Info column

- User drags an order into a column with `kind = 'exception'` (default name: "Missing Info").
- `Board.onDragEnd` calls `POST /api/orders/move`.
- If the column has an enabled automation rule with `config.action = 'notify'` and `notify_type = 'missing_info'`, **or** the column kind is `exception`, the move succeeds and `NotificationPopup` opens.

### 2. Popup — operator fills note + selects channel

- `MissingInfoPopup` shows customer contact (from custom fields + linked customer).
- Channels: **Email**, **SMS** (if Twilio configured), **Manual** (link only, no send).
- Email shows a read-only preview from `lib/notification-messages.ts` (staff note included).
- Operator clicks Send.

### 3. Email path → Instantly → customer link

- `POST /api/notifications/send` with `type: "missing_info"`, `channel: "email"`.
- `createNotification()` in `lib/notifications.ts`:
  - Inserts `job_notifications` row (`status: sent`, unique `token`).
  - Builds URL: `{NEXT_PUBLIC_APP_URL}/respond/{token}`.
  - Calls `sendCustomerNotificationEmail()` → Instantly API (`lib/email.ts`).
  - If Instantly unset, logs URL to server console.
  - Writes `activity_log` (`notification_sent`).
- Order **remains** in Missing Info column until customer responds.

### 4. Customer opens `/respond/[token]`

- Server calls RPC `get_notification_by_token`.
- Page renders `OrderReview` (full order, SKUs, artwork) + `RespondForm`.
- Customer attaches files via `POST /api/notifications/upload` (token-gated).
- Customer submits note and/or files.

### 5. Response → order moves to target column

- `POST /api/notifications/respond` with `response: "info_submitted"`.
- `respondToNotification()`:
  - Validates token, expiry, requires note or attachment.
  - Moves order to `to_column` on the enabled `notify` + `missing_info` automation rule, **or** a column named **"Customer Replied"** (`customerRepliedColumnId`).
  - **Note:** Default tenant seed has "Returning Tickets" but not "Customer Replied" — configure the automation target column in Settings → Automations, or the order may not move.
  - Sets `job_notifications.status = responded`, stores `customer_note` / `customer_response`.
  - Logs activity.

### 6. Board updates via Realtime

- Order `column_id` change fires Postgres Realtime on `orders`.
- `Board` subscription calls `router.refresh()` — no manual page reload.

**Key files:** `components/board/board.tsx`, `components/notify/MissingInfoPopup.tsx`, `lib/notifications.ts`, `app/respond/[token]/page.tsx`.

---

## Customer Approval workflow

### 1. Card dropped to Customer Approval column

- Target column has `kind = 'approval'` (default: "Customer Approval").
- Same drag + move API as above.
- `NotificationPopup` opens with `type: "customer_approval"` (`ApprovalPopup`).

### 2. Popup — channel + optional note

- Operator selects Email / SMS / Manual.
- `POST /api/notifications/send` with `type: "customer_approval"`.
- Customer receives link to same `/respond/{token}` page (UI adapts to approval mode).

### 3. Customer reviews proof and decides

- `RespondForm` shows Approve / Not Approved buttons.
- Customer may leave a note on rejection.

### 4a. Approved → card moves per Automations settings

- `respondToNotification` calls `onApprovalResult()` with `result: "approved"`.
- Finds `automation_rules` where `trigger = on_approval_result` and `config.result = "approved"`.
- Moves order to configured `to_column` (default seed: **Done**).
- Notification marked `responded`, `customer_response: "approved"`.

### 4b. Not Approved → card stays, badge + tab note

- `customer_response: "changes_requested"`.
- Order **stays** in approval column.
- `activity_log` entry `rejected` with customer note.
- `ApprovalTab` in order detail shows rejection; card may show **Rejected** badge (`lib/card-badges.ts`).

### Manual staff override

- From `ApprovalTab`: `POST /api/notifications/[id]/manual-approve` forces approved path without customer action.

**Key files:** `components/notify/ApprovalPopup.tsx`, `lib/automation.ts` (`onApprovalResult`), `components/board/approval-tab.tsx`.

---

## Column Notification Rules workflow

Automated, operator-free email/SMS fired whenever a card enters a column.

### 1. Admin sets up a rule

- Settings → Button Automation → **Notification Rules** section.
- Admin configures: name, trigger (`on_enter_column`), target column (or "any column"), recipient (`customer` / `staff` / `both`), email subject/body, SMS body, and optionally a fixed **Contact number** (`sms_to_phone`).
- Rule saved to `notification_rules` table via `POST /api/notification-rules`.

### 2. Order card moves columns

- Any user drags a card to a new column → `POST /api/orders/move`.
- After the DB update succeeds, `fireNotificationRules(orderId, toColumnId, tenantId)` is called **asynchronously** (non-blocking fire-and-forget).

### 3. Rule matching

`lib/fire-notification-rules.ts`:

- Loads all enabled rules for the tenant where `column_id = toColumnId` OR `column_id IS NULL`.
- For each matching rule, loads the order, customer, and staff (`assigned_to` profile).

### 4. Template rendering

- Subject/body/SMS are processed through a simple `{{variable}}` template engine.
- Available variables: `order_number`, `customer_name`, `column_name`, `due_date`, `product`, `tenant_name`.

### 5. Send email

- If `send_email = true` and recipient has an email address.
- Calls `sendTransactionalEmail()` (Instantly) with rendered subject + body.
- Recipient resolution: `customer` → customer email from order; `staff` → `assigned_to` profile email; `both` → both.

### 6. Send SMS

- If `send_sms = true`.
- **Phone override:** if `sms_to_phone` is set on the rule, SMS is sent to that number regardless of recipient setting.
- **Fallback:** otherwise resolves phone from customer (`phone` custom field or customer record) or staff profile.
- Calls `sendSms()` (Twilio).

**Key files:** `lib/fire-notification-rules.ts`, `lib/notification-rules.ts`, `lib/notification-rules.server.ts`, `app/api/notification-rules/`, `app/(app)/settings/button-automation/notification-rules-manager.tsx`.

---

## Team invite workflow

### 1. Admin opens `/settings/team`

- `TeamManager` loads members via `GET /api/members`.

### 2. Enter email + role → Send invite

- `POST /api/members` with `{ email, role, fullName? }`.
- Requires `SUPABASE_SERVICE_ROLE_KEY`.

### 3. Supabase `generateLink` + Instantly email

- `lib/team-invite.ts` → `sendTeamInvite()`:
  - `admin.auth.admin.generateLink({ type: "invite", email })` (does not use Supabase built-in email).
  - Normalizes link to `/signup?...` with `invite_email` / `invite_name` params.
  - Sends via Instantly (`sendTeamInviteEmail`) or returns `inviteUrl` for manual copy.

### 4. New user accepts invite

- User opens link → `app/(auth)/signup/page.tsx` exchanges token / verifies OTP.
- User sets password on invite flow.
- `memberships` row created for tenant (on invite POST, before signup completes).
- After login, `getTenantContext()` resolves tenant → user lands on `/board`.

**Resend / revoke:** Team manager can resend (`POST /api/members` again) or `DELETE /api/members/[userId]` for pending invites.

---

## Order create workflow

1. User clicks "+" on a column → `CreateOrderModal`.
2. Fills title, custom fields, SKUs, optional artwork (immediate upload on create).
3. `POST /api/orders` → links customer from field values, inserts order + field values.
4. `logActivity` (`created`).
5. Board refreshes; new card appears in column.

---

## Order edit workflow (deferred assets)

1. Click card → `CardDetailModal` loads `GET /api/orders/[id]`.
2. User edits fields / adds SKU artwork — files held in `pendingSkuArtwork` / `pendingOrderAssets` state.
3. On **Save changes** → `PATCH /api/orders/[id]` then batch upload/delete assets.
4. Avoids full `load()` on each file pick (prevents form reset).

---

## Column automation (non-notification)

When an order enters any column, `onEnterColumn()` (`lib/automation.ts`):

- Runs enabled `on_enter_column` rules (excluding `notify` actions to avoid loops).
- Single hop — no chaining.

Default seed also includes `on_approval_result` rules for legacy `approvals` table flow.

---

## Legacy approval workflow (`/approve/[token]`)

Older path using `approvals` table and `createApprovalForOrder()`. **Not triggered** by current board notification popups. Still functional for:

- Direct RPC `get_approval_by_token`
- `POST /api/approvals/decide`

New work should use `job_notifications` + `/respond/[token]`.

---

## Deployment

**Last updated: June 23, 2026**

## Prerequisites

| Requirement | Notes |
| --- | --- |
| **Node.js 20+** | Matches Vercel default; repo uses Next 16 |
| **Supabase project** | Postgres, Auth, Storage, Realtime |
| **Instantly account** | Optional; customer + invite emails |
| **Twilio account** | Optional; SMS notifications |
| **Vercel account** | Recommended hosting |
| **Custom domain** | Required for production customer links |

---

## Local development setup

### 1. Clone and install

```bash
git clone <repo-url>
cd Workflow
npm install
```

### 2. Environment

```bash
cp .env.local.example .env.local
```

Fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`

Optional: Instantly and Twilio keys (see `.env.local.example`).

### 3. Supabase database

**Option A — CLI (recommended):**

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Option B — SQL Editor:**

Run `supabase/setup.sql` once in Supabase SQL Editor for a full bootstrap (includes items not in all migrations).

After DDL changes, reload the API schema cache: **Project Settings → API → Reload schema**.

### 4. Supabase Auth redirect URLs

In **Authentication → URL Configuration**, add:

| URL | Purpose |
| --- | --- |
| `http://localhost:3000/**` | Local dev |
| `https://your-domain.com/**` | Production |
| `http://localhost:3000/signup` | Team invite completion |
| `https://your-domain.com/signup` | Production invites |

### 5. Supabase Realtime

**Database → Replication** — enable Realtime for the `orders` table.

### 6. Storage buckets

Migrations create:

- `order-assets` (private)
- `column-images` (public)

Verify buckets exist under **Storage** after migrations.

### 7. Run dev server

```bash
npm run dev
```

Visit `http://localhost:3000`, sign up, complete onboarding (create tenant).

### 8. Verify build

```bash
npm run typecheck
npm run lint
npm run build
```

---

## Vercel deployment

### 1. Import project

Connect GitHub repo to Vercel. Framework preset: **Next.js**.

### 2. Environment variables

Add all variables from `.env.local.example` in **Vercel → Settings → Environment Variables**:

| Variable | Environments |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All |
| `SUPABASE_SERVICE_ROLE_KEY` | All (server only) |
| `NEXT_PUBLIC_APP_URL` | Production: `https://your-domain.com` |
| `INSTANTLY_API_KEY` | Production (optional) |
| `INSTANTLY_FROM_EMAIL` | Production (optional) |
| `TWILIO_*` | Production (optional) |

**Critical:** `NEXT_PUBLIC_APP_URL` must match the deployed domain so customer email links work.

### 3. Deploy

Push to `main` or trigger manual deploy. Vercel runs `npm run build`.

### 4. Custom domain

Add domain in Vercel → Domains. Update:

- `NEXT_PUBLIC_APP_URL` to production URL
- Supabase Auth redirect URLs to production domain

---

## Post-deploy checklist

- [ ] Sign up / login works
- [ ] Onboarding creates tenant with default columns
- [ ] Board loads orders; drag-and-drop persists
- [ ] Realtime: second browser tab sees moves without refresh
- [ ] Create order + upload artwork
- [ ] Drop to Missing Info → email sends (or link in logs)
- [ ] Customer `/respond/[token]` loads order review + submit works
- [ ] Drop to Approval → approve/reject moves card correctly
- [ ] Team invite email delivers; signup completes
- [ ] `SUPABASE_SERVICE_ROLE_KEY` not exposed in client bundle
- [ ] Storage downloads work for staff and token-gated customer assets

---

## Production recommendations

1. **Use migrations** for schema changes; keep `setup.sql` in sync for fresh installs.
2. **Monitor Instantly/Twilio** delivery; fall back to manual link copy in UI.
3. **Set token expiry** if required — `token_expires_at` on `job_notifications` [TODO: verify if UI exposes expiry config].
4. **Backups** — enable Supabase point-in-time recovery on paid plan.
5. **Rate limiting** — consider Vercel / Supabase edge limits for public `/api/notifications/*` routes before wide public launch.

---

## Troubleshooting

| Issue | Fix |
| --- | --- |
| `Could not find column X in schema cache` | Run missing migration SQL; reload PostgREST schema |
| Customer links go to localhost | Fix `NEXT_PUBLIC_APP_URL` on Vercel |
| Team invite fails | Add `SUPABASE_SERVICE_ROLE_KEY`; check redirect URLs |
| SMS in dev | Dev script unsets Twilio vars — intentional |
| Board doesn't live-update | Enable Realtime on `orders` |
| `sku_key` errors | Apply `sku_key` section from `setup.sql` |

See `#known-issues` for ongoing gaps.

---

## Known issues

**Last updated: June 23, 2026**

Items identified from codebase audit and production debugging. Verify status before treating as fixed.

---

## Known bugs / operational issues

### Schema cache out of sync

After applying SQL manually, PostgREST may return errors like:

```
Could not find the 'sku_key' column of 'assets' in the schema cache
Could not find the 'updated_at' column of 'customers' in the schema cache
```

**Fix:** Run the correct migration (or `setup.sql` section), then **Supabase Dashboard → Settings → API → Reload schema**.

### Migration numbering gap

Migrations jump from `0009` to `0011` (no `0010_*.sql` in repo). Historical duplicate `0008` files caused some migrations to be skipped in older setups.

### `sku_key` not in migrations

`assets.sku_key` exists in `supabase/setup.sql` but **not** in `supabase/migrations/`. Fresh `db push` may miss this column until manual SQL is applied.

### `drop_in_roles` / `drop_out_roles` not in migrations

Column permission arrays are in `setup.sql` only. App types and `lib/permissions.ts` expect them; DB may lack columns if only migrations were applied.

**Normalization:** `lib/columns.ts` exports `parseDropRoles()` and `effectiveDropRoles()` to handle legacy rows where the column stored all roles instead of `null` (meaning "everyone"). Use these helpers instead of reading the raw array.

**Drag permission note:** `lib/permissions.ts` provides `canDragInColumn()` which returns `true` if the user has either `drop-out` or `drop-in` permission for a column — this allows reordering cards within a column even when drop-out is restricted.

### Extended `member_role` enum

App `Role` type includes `preprod_owner`, `designer`, `account_manager`. DB enum may only have `admin` / `member` unless extended via `setup.sql`. [TODO: verify migration for enum extension]

### Missing-info fallback column name mismatch

`customerRepliedColumnId()` in `lib/notifications.ts` looks for a column named **"Customer Replied"**, but `create_tenant()` seeds **"Returning Tickets"** instead. If no `notify` automation rule defines `to_column`, customer missing-info responses may not move the card. **Workaround:** set target column in Settings → Automations for the missing-info notify rule, or add/rename a column to "Customer Replied".

### Board crash from wrong function args

`customerNameFromOrder(order, fieldValues, customFields)` argument order matters. Swapping `customFields` and `fieldValues` caused runtime `ORDER_QTY_FIELD_NAME is not defined` style errors. Fixed in `order-card.tsx` — regression test recommended.

---

## Features planned / not built

| Item | Status |
| --- | --- |
| `comments` table / in-app comments | Not implemented |
| Realtime on `job_notifications` | Only `orders` subscribed |
| Customer CRUD API | Intentionally returns 403; customers auto-derived |
| Token expiry UI in settings | Column exists; operator UI may not configure expiry |
| Chained automations | Single-hop only (`onEnterColumn`) |
| Mobile-optimized board | Desktop-first Kanban |
| Audit export / reporting | `GET /api/analytics` added; full dashboard in `AnalyticsDashboard.tsx` |
| Column notification rules | **Implemented** — `notification_rules` table + `fireNotificationRules` + Settings UI |
| Fast action buttons | **Implemented** — `button_automations` table + trigger API + `FastActionButtonBar` on cards |
| Column visibility per role | **Implemented** — `visible_to_roles` / `visible_to_users` on `board_columns`; `lib/check-visibility.ts` |

---

## Tech debt

### Dual approval systems

- **Current:** `job_notifications` + `/respond/[token]` + `NotificationPopup`
- **Legacy:** `approvals` + `/approve/[token]` + `createApprovalForOrder()` in `lib/automation.ts`

`createApprovalForOrder()` is **defined but unused** by the main board flow. Consolidate or remove legacy path.

### `proxy.ts` without root `middleware.ts`

`proxy.ts` exports session refresh from `lib/supabase/middleware.ts`, but there is no `middleware.ts` at project root. Auth relies on server layouts (`getTenantContext`) and per-route checks. Session cookie refresh may be incomplete on edge navigations. [TODO: verify Next.js 16 proxy convention]

### `setup.sql` vs migrations drift

`setup.sql` is a superset of migrations (sku_key, drop roles, extended RPCs, manual channel). Risk of environments diverging.

### README vs code

README still describes legacy approval-on-enter-column behavior; primary flow is notification popups + `job_notifications`.

### Activity log trimming

`trimActivityLog` keeps a fixed limit per order (`ACTIVITY_LOG_LIMIT`); older entries deleted silently.

### Edit modal complexity

`card-detail-modal.tsx` is large; deferred upload state (`pendingSkuArtwork`, etc.) is easy to break when adding new asset types.

---

## Security items before public launch

| Item | Risk | Mitigation |
| --- | --- | --- |
| Public notification routes | Token brute-force | Tokens are UUIDs; consider rate limiting |
| Service role key | Full DB bypass | Server-only; never `NEXT_PUBLIC_*` |
| Storage signed URLs | Time-limited leak | Short TTL on staff signed URLs |
| RLS on all tables | Data leak | Audit new tables for `tenant_id` + policies |
| Customer upload | Malware / size | [TODO: verify] upload size limits and MIME checks |
| Invite links | Account takeover | Short-lived Supabase invite tokens |
| SMS cost abuse | Twilio charges | Dev script unsets Twilio; prod needs rate limits |

---

## Testing gaps

- No automated test suite in repo (`package.json` has no `test` script).
- Critical paths (notification respond, move + automation, invite) are manual-test only.

---

## Documentation maintenance

When changing schema or API:

1. Add migration file (sequential number).
2. Update `supabase/setup.sql` if used for greenfield installs.
3. Update `docs/DOCUMENTATION.md` (root `CLAUDE.md` is only a pointer).
4. Reload PostgREST schema after deploy.
