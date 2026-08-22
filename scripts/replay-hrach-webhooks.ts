/**
 * Re-POST the Hrach-column PulseWebhook once for every live order in Hrach.
 * Does not send the rule's email/SMS.
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs --env-file=.env.local scripts/replay-hrach-webhooks.ts
 */
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { resolve } from "node:path";

const HRACH_COLUMN_ID = "693d28b5-8e6e-44fa-a0f8-f21da42c53ac";
const PULSE_RULE_ID = "546dcbb6-a2f5-4d35-8aff-6d5ef7e29937";

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

loadEnvLocal();

const originalLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { loadOrderExportData } = await import(
    "../lib/button-automation-order-data.ts"
  );
  const { buildFullOrderWebhookPayload } = await import(
    "../lib/order-webhook-payload.ts"
  );

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: rule, error: ruleErr } = await sb
    .from("notification_rules")
    .select("*")
    .eq("id", PULSE_RULE_ID)
    .maybeSingle();
  if (ruleErr) throw ruleErr;
  if (!rule?.webhook_url?.trim()) {
    throw new Error("PulseWebhook rule has no webhook_url");
  }

  const { data: orders, error: orderErr } = await sb
    .from("orders")
    .select("id, title, tenant_id")
    .eq("column_id", HRACH_COLUMN_ID)
    .is("removed_at", null)
    .order("title");
  if (orderErr) throw orderErr;
  if (!orders?.length) {
    console.log("No orders in Hrach.");
    return;
  }

  const oneOnly = process.argv.includes("--one");
  const rows = oneOnly ? orders.slice(0, 1) : orders;

  const { data: tenant } = await sb
    .from("tenants")
    .select("name")
    .eq("id", orders[0].tenant_id)
    .maybeSingle();
  const tenantName = tenant?.name ?? "Workflow";
  const url = String(rule.webhook_url).trim();
  const headers = (rule.webhook_headers ?? {}) as Record<string, string>;
  const movedAt = new Date().toISOString();

  console.log(
    `Replaying PulseWebhook for ${rows.length} Hrach order(s) → ${url}`
  );

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    const exportData = await loadOrderExportData(
      sb,
      row.id,
      row.tenant_id,
      tenantName
    );
    if (!exportData) {
      fail += 1;
      console.log(`  FAIL ${row.title} — could not load order`);
      continue;
    }
    exportData.columnName = "Hrach";
    const body = JSON.stringify(
      buildFullOrderWebhookPayload(exportData, {
        event: "order_entered_column",
        columnId: HRACH_COLUMN_ID,
        tenantId: row.tenant_id,
        movedAt,
      })
    );
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body,
      });
      const text = await res.text().catch(() => "");
      if (res.ok) {
        ok += 1;
        console.log(`  OK   ${row.title}  ${res.status}  ${text}`);
      } else {
        fail += 1;
        console.log(
          `  FAIL ${row.title}  ${res.status} ${text.slice(0, 180)}`
        );
      }
    } catch (err) {
      fail += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  FAIL ${row.title}  ${message}`);
    }
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
