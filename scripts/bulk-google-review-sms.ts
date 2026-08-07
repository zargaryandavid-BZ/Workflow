/**
 * Send Google Review SMS for open orders in "Finished: Review Request"
 * that do not already have the Review tag. One SMS per unique phone.
 *
 *   npx tsx scripts/bulk-google-review-sms.ts --dry-run
 *   npx tsx scripts/bulk-google-review-sms.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

const COLUMN_NAME = "Finished: Review Request";
const BUTTON_NAME = "Google Review";
const DRY_RUN = process.argv.includes("--dry-run");

function loadEnvLocal() {
  const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function hasReviewTag(specs: unknown): boolean {
  const tags = (specs as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags)) return false;
  return tags.some(
    (t) => typeof t === "string" && t.trim().toLowerCase() === "review"
  );
}

function normalizePhone(raw: string): string {
  const value = raw.trim();
  if (value.startsWith("+")) return `+${value.slice(1).replace(/\D/g, "")}`;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function phoneFromContact(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (value.includes("@")) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return normalizePhone(value);
}

async function sendSms(
  to: string,
  body: string
): Promise<{ sent: boolean; sid?: string; error?: string }> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!sid || !token || !from) {
    return { sent: false, error: "SMS not configured" };
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from,
        To: normalizePhone(to),
        Body: body,
      }),
    }
  );
  if (!res.ok) {
    return { sent: false, error: await res.text() };
  }
  try {
    const json = (await res.json()) as { sid?: string };
    return { sent: true, sid: json.sid };
  } catch {
    return { sent: true };
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const sb = createClient(url, key);

  const { data: col } = await sb
    .from("board_columns")
    .select("id, tenant_id, name")
    .ilike("name", COLUMN_NAME)
    .maybeSingle();
  if (!col) throw new Error(`Column not found: ${COLUMN_NAME}`);

  const { data: button } = await sb
    .from("button_automations")
    .select("id, name, config")
    .eq("tenant_id", col.tenant_id)
    .ilike("name", BUTTON_NAME)
    .eq("enabled", true)
    .maybeSingle();
  if (!button) throw new Error(`Button not found: ${BUTTON_NAME}`);

  const bodyTemplate =
    typeof (button.config as { body_template?: string })?.body_template ===
    "string"
      ? (button.config as { body_template: string }).body_template.trim()
      : "";
  if (!bodyTemplate) throw new Error("Google Review button has no body_template");

  const { data: orders, error } = await sb
    .from("orders")
    .select("id, title, customer_id, specs")
    .eq("tenant_id", col.tenant_id)
    .eq("column_id", col.id)
    .is("removed_at", null);
  if (error) throw error;

  const targets = (orders ?? []).filter((o) => !hasReviewTag(o.specs));
  console.log(
    `${COLUMN_NAME}: ${orders?.length ?? 0} open, ${targets.length} without Review tag`
  );

  const custIds = [
    ...new Set(targets.map((o) => o.customer_id).filter(Boolean) as string[]),
  ];
  const { data: customers } = await sb
    .from("customers")
    .select("id, name, phone")
    .in("id", custIds.length ? custIds : ["00000000-0000-0000-0000-000000000000"]);
  const custById = new Map((customers ?? []).map((c) => [c.id, c]));

  const { data: fields } = await sb
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", col.tenant_id);
  const contactFieldId = (fields ?? []).find((f) =>
    /customer contact/i.test(f.name)
  )?.id;

  const orderIds = targets.map((o) => o.id);
  const cfPhone = new Map<string, string>();
  if (contactFieldId && orderIds.length) {
    const { data: cfvs } = await sb
      .from("custom_field_values")
      .select("order_id, value")
      .eq("custom_field_id", contactFieldId)
      .in("order_id", orderIds);
    for (const row of cfvs ?? []) {
      const phone = phoneFromContact(row.value);
      if (phone) cfPhone.set(row.order_id as string, phone);
    }
  }

  type Group = {
    phone: string;
    orders: Array<{ id: string; title: string; specs: Record<string, unknown> }>;
  };
  const byPhone = new Map<string, Group>();
  const skipped: string[] = [];

  for (const o of targets) {
    const cust = o.customer_id ? custById.get(o.customer_id) : null;
    const phone =
      phoneFromContact(cust?.phone) ?? cfPhone.get(o.id) ?? null;
    if (!phone) {
      skipped.push(`${o.title} (no phone)`);
      continue;
    }
    const g = byPhone.get(phone) ?? { phone, orders: [] };
    g.orders.push({
      id: o.id,
      title: o.title,
      specs: (o.specs ?? {}) as Record<string, unknown>,
    });
    byPhone.set(phone, g);
  }

  console.log(
    `Will send ${byPhone.size} SMS (deduped by phone). Skip ${skipped.length} without phone.`
  );
  if (DRY_RUN) {
    for (const g of byPhone.values()) {
      console.log(
        `[dry-run] ${g.phone} ← ${g.orders.map((o) => o.title).join(", ")}`
      );
    }
    for (const s of skipped) console.log(`[skip] ${s}`);
    console.log("Dry run only — no SMS sent.");
    return;
  }

  let sent = 0;
  let failed = 0;
  let tagged = 0;

  for (const g of byPhone.values()) {
    const result = await sendSms(g.phone, bodyTemplate);
    if (!result.sent) {
      failed += 1;
      console.error(
        `FAIL ${g.phone} (${g.orders.map((o) => o.title).join(", ")}): ${result.error}`
      );
      continue;
    }
    sent += 1;

    const primary = g.orders[0]!;
    await sb.from("order_sms_messages").insert({
      tenant_id: col.tenant_id,
      order_id: primary.id,
      direction: "outbound",
      phone: g.phone,
      body: bodyTemplate,
      twilio_sid: result.sid ?? null,
      actor_user_id: null,
    });

    for (const order of g.orders) {
      const { error: tagErr } = await sb
        .from("orders")
        .update({
          specs: { ...order.specs, tags: ["Review"] },
        })
        .eq("id", order.id)
        .eq("tenant_id", col.tenant_id);
      if (tagErr) {
        console.error(`TAG FAIL ${order.title}: ${tagErr.message}`);
      } else {
        tagged += 1;
      }
    }
    console.log(
      `OK ${g.phone} → tagged ${g.orders.map((o) => o.title).join(", ")}`
    );
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(
    `\nDone. SMS sent: ${sent}, failed: ${failed}, orders tagged Review: ${tagged}, skipped no phone: ${skipped.length}`
  );
  if (skipped.length) {
    console.log("Skipped:", skipped.join("; "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
