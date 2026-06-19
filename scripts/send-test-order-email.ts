/**
 * One-off: send a button-automation order email to a given address.
 * Usage: npx tsx scripts/send-test-order-email.ts <toEmail> [orderTitle]
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { Module } from "module";

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) {
        process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // ignore
  }
}

// Allow importing server-only modules in this script.
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
  loadEnvLocal();

  const to = process.argv[2]?.trim();
  const orderTitle = process.argv[3]?.trim() ?? "ORD-2026-013-3";

  if (!to) {
    console.error("Usage: npx tsx scripts/send-test-order-email.ts <toEmail> [orderTitle]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.INSTANTLY_API_KEY?.trim();
  const from = process.env.INSTANTLY_FROM_EMAIL?.trim();

  if (!url || !key) {
    console.error("Missing Supabase env vars in .env.local");
    process.exit(1);
  }
  if (!apiKey || !from) {
    console.error("Missing INSTANTLY_API_KEY or INSTANTLY_FROM_EMAIL in .env.local");
    process.exit(1);
  }

  const { loadOrderExportData } = await import(
    "../lib/button-automation-order-data"
  );
  const {
    buildButtonAutomationEmailHtml,
    buildButtonAutomationEmailSubject,
  } = await import("../lib/button-automation-messages");
  const { sendTransactionalEmail } = await import("../lib/email");

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: order } = await admin
    .from("orders")
    .select("id, tenant_id, title")
    .eq("title", orderTitle)
    .maybeSingle();

  if (!order) {
    console.error(`Order not found: ${orderTitle}`);
    process.exit(1);
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", order.tenant_id)
    .single();

  const exportData = await loadOrderExportData(
    admin,
    order.id,
    order.tenant_id,
    tenant?.name ?? "Print Manager"
  );

  if (!exportData) {
    console.error("Failed to load order export data");
    process.exit(1);
  }

  const subject = buildButtonAutomationEmailSubject(exportData, {});
  const html = buildButtonAutomationEmailHtml(exportData);

  console.log(`Sending "${subject}" to ${to} for order ${order.title}…`);

  const result = await sendTransactionalEmail({ to, subject, html });

  if (!result.sent) {
    console.error("Failed:", result.error ?? "Unknown error");
    process.exit(1);
  }

  console.log("Email sent successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
