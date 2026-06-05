# Automated Print Production Manager

A multi-tenant, Trello-style Kanban platform for print houses. Jobs flow through
an automated pipeline from order creation to production-ready, with custom
fields, file assets, customer approval sign-off, and column automation rules.

Built with **Next.js (App Router) + TypeScript + Tailwind** on **Vercel**, backed
entirely by **Supabase** (Postgres, Auth, Storage) with **Row-Level Security**
for strict tenant isolation.

## Pipeline

```
START (Order Created) -> In Progress -> Customer Approval -> Done (Ready for Prod)
                              \-> Missing Info / Returning Tickets (exceptions)
```

When a job enters **Customer Approval**, an approval record + public sign-off
link is generated. When the customer approves, the job is automatically moved to
**Done**; on rejection it returns to **Returning Tickets** (configurable via
automation rules). Every transition is written to an activity log.

## Tech Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4
- Supabase: Postgres + Auth + Storage + Realtime, secured by RLS
- `@dnd-kit` drag-and-drop, `@tanstack/react-query`, `lucide-react`
- Optional Instantly (customer email) + Twilio (SMS) for customer notifications

## Architecture

```
app/
  (auth)/login, (auth)/signup   Supabase Auth screens
  onboarding                    Create / pick a tenant
  (app)/board                   Kanban board (drag-and-drop + realtime)
  (app)/customers               Customer directory
  (app)/settings/fields         Custom field definitions (admin)
  (app)/settings/automations    Automation rules (admin)
  (app)/settings/team           Members & invites (admin)
  approve/[token]               Public, no-auth customer approval page
  api/                          Mutations that run automation + activity logging
lib/supabase/                   Browser / server / admin clients + middleware
supabase/migrations/            Schema, functions, RLS policies
```

Mutations that must run automation atomically (card moves, approval decisions,
asset signing) go through `app/api/*` route handlers. Reads use the Supabase
client directly with Realtime subscriptions for live board updates.

## Multi-Tenancy

Every business table carries a `tenant_id`. Users belong to tenants via the
`memberships` table (`admin` / `member`). RLS policies grant access only to rows
whose `tenant_id` is in the caller's memberships, enforced by the
`is_tenant_member()` / `is_tenant_admin()` SQL helpers. Storage objects are
namespaced as `{tenant_id}/{order_id}/{filename}` and gated by the same check.

## Getting Started

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com). From
**Project Settings -> API** copy the project URL, the `anon` key, and the
`service_role` key.

### 2. Configure environment

```bash
cp .env.local.example .env.local
# then fill in the values
```

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key |
| `NEXT_PUBLIC_APP_URL` | App base URL (for approval links) |
| `INSTANTLY_API_KEY` | Optional; customer emails via Instantly API v2. If empty, links are logged |
| `INSTANTLY_FROM_EMAIL` | Connected Instantly workspace sender (`eaccount`) for customer emails |
| `TWILIO_ACCOUNT_SID` | Optional; customer SMS. If empty, SMS is logged |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio sending number (E.164) |

### 3. Apply the database migrations

**Option A - Supabase CLI (recommended):**

```bash
npm i -g supabase
supabase link --project-ref <your-project-ref>
supabase db push
```

**Option B - SQL editor:** paste the contents of the files in
`supabase/migrations/` (in numeric order) into the Supabase SQL editor and run
them.

This creates all tables, the `is_tenant_member` / `create_tenant` functions, RLS
policies, and the private `order-assets` storage bucket.

### 4. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, create a tenant,
and the board seeds with the six pipeline columns automatically.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add the same environment variables in the Vercel project settings.
4. In Supabase **Auth -> URL Configuration**, set the Site URL and redirect URLs
   to your Vercel domain (e.g. `https://your-app.vercel.app`).

## Smoke Test

Sign up -> create a tenant -> board shows 6 columns -> create an order -> drag it
between columns -> add a custom field and value -> upload an asset -> move the
card to **Customer Approval** -> open the generated approval link -> approve ->
the card lands in **Done (Ready for Prod)**.
