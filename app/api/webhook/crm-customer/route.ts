import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findWebhookConfigBySecret } from "@/lib/webhook-config";
import { secretsMatch } from "@/lib/webhook-order";
import { findCustomerByContacts } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRM -> Workflow contact sync receiver.
 *
 * The CRM (lib/utils/notify-board-customer-contact.ts) POSTs here when a customer's
 * contact fields change. We match the Workflow customer by email/phone and update its
 * contact so the board reflects the CRM edit. This is the missing half of the
 * already-built CRM->Workflow contact push (CRM points BOARD_CUSTOMER_SYNC_URL here).
 *
 * Auth: header `x-webhook-secret` must match the tenant's webhook secret (same secret
 * the CRM sends). Idempotent: no-op when nothing changed. This path never emits an
 * outbound sync, so it can't create a ping-pong loop.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret")?.trim();
  if (!secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const cfg = await findWebhookConfigBySecret(adminClient, secret);
  if (!cfg || !secretsMatch(secret, cfg.secret_key)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tenantId = cfg.tenant_id;

  const body = (await request.json().catch(() => null)) as {
    event?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    email?: string;
    phone?: string;
  } | null;
  if (!body || body.event !== "customer.contact_updated") {
    return NextResponse.json({ ok: true, skipped: "ignored_event" });
  }

  const email = (body.email ?? "").trim() || null;
  const phone = (body.phone ?? "").trim() || null;
  const customer = await findCustomerByContacts(adminClient, tenantId, { email, phone });
  if (!customer) return NextResponse.json({ ok: true, skipped: "no_match" });

  const name = [body.first_name, body.last_name]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const company = typeof body.company === "string" ? body.company.trim() || null : undefined;

  const patch: Record<string, unknown> = {};
  if (name) patch.name = name;
  if (company !== undefined) patch.company = company;
  if (email) patch.email = email;
  if (phone) patch.phone = phone;

  const changed =
    (patch.name !== undefined && patch.name !== customer.name) ||
    (patch.company !== undefined && patch.company !== customer.company) ||
    (patch.email !== undefined && patch.email !== customer.email) ||
    (patch.phone !== undefined && patch.phone !== customer.phone);
  if (!changed) {
    return NextResponse.json({ ok: true, skipped: "no_change", customer_id: customer.id });
  }

  patch.updated_at = new Date().toISOString();
  let { error } = await adminClient
    .from("customers")
    .update(patch)
    .eq("id", customer.id)
    .eq("tenant_id", tenantId);

  if (error) {
    // A unique(email)/unique(phone) collision on this tenant — fall back to the
    // non-conflicting fields so the name/company still sync.
    const safe: Record<string, unknown> = { updated_at: patch.updated_at };
    if (patch.name !== undefined) safe.name = patch.name;
    if (patch.company !== undefined) safe.company = patch.company;
    ({ error } = await adminClient
      .from("customers")
      .update(safe)
      .eq("id", customer.id)
      .eq("tenant_id", tenantId));
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updated: "name_company_only", customer_id: customer.id });
  }

  return NextResponse.json({ ok: true, updated: true, customer_id: customer.id });
}
