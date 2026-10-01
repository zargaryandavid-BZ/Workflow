/**
 * Force-regenerate a FedEx label for an order (Home Delivery remap applies).
 *
 * Usage:
 *   npx tsx scripts/retry-fedex-label.ts W150-1
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { Module } from "node:module";
import { createClient } from "@supabase/supabase-js";

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
    process.env[key] = value;
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
  const { ensureFedExLabel } = await import("../lib/fedex-label");
  const title = process.argv[2]?.trim();
  if (!title) {
    console.error("Usage: npx tsx scripts/retry-fedex-label.ts ORDER-TITLE");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: orders, error: orderErr } = await admin
    .from("orders")
    .select("id, title, tenant_id")
    .ilike("title", title)
    .limit(5);

  if (orderErr) throw new Error(orderErr.message);
  if (!orders?.length) throw new Error(`No order titled ${title}`);
  if (orders.length > 1) {
    console.log(orders.map((o) => `${o.title} ${o.id}`).join("\n"));
  }

  const order = orders[0]!;
  const { data: reqs, error: reqErr } = await admin
    .from("shipping_requests")
    .select(
      "id, status, client_choice, fedex_shipment_status, fedex_label_error, fedex_selection"
    )
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (reqErr) throw new Error(reqErr.message);
  const row = reqs?.[0];
  if (!row) throw new Error(`No shipping request for ${order.title}`);

  console.log(`order ${order.title} (${order.id})`);
  console.log(`shipping_request ${row.id} status=${row.fedex_shipment_status}`);
  console.log(
    `service ${(row.fedex_selection as { serviceType?: string } | null)?.serviceType}`
  );
  if (row.fedex_label_error) console.log(`last error: ${row.fedex_label_error}`);

  const result = await ensureFedExLabel(admin, row.id, { force: true });
  if (!result.ok) {
    console.error(`failed: ${result.error}`);
    process.exit(1);
  }
  console.log(
    result.skipped
      ? "skipped"
      : `created tracking ${result.trackingNumber ?? "—"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
