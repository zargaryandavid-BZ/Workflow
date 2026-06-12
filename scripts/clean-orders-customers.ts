/**
 * Deletes all orders (and cascaded order data) and all customers.
 *
 * Usage:
 *   npm run clean-orders-customers
 *   npm run clean-orders-customers -- <tenant-uuid>   # one tenant only
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
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
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

async function countRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  table: "orders" | "customers",
  tenantId: string | null
): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  const tenantId = process.argv[2] || null;
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (tenantId) {
    console.log(`Cleaning orders + customers for tenant ${tenantId}…`);
  } else {
    console.log("Cleaning ALL orders + customers (all tenants)…");
  }

  const orderCountBefore = await countRows(supabase, "orders", tenantId);
  const customerCountBefore = await countRows(supabase, "customers", tenantId);

  const ordersDelete = tenantId
    ? supabase.from("orders").delete().eq("tenant_id", tenantId)
    : supabase
        .from("orders")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: delOrdersErr } = await ordersDelete;
  if (delOrdersErr) {
    console.error("Failed to delete orders:", delOrdersErr.message);
    process.exit(1);
  }

  const customersDelete = tenantId
    ? supabase.from("customers").delete().eq("tenant_id", tenantId)
    : supabase
        .from("customers")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
  const { error: delCustomersErr } = await customersDelete;
  if (delCustomersErr) {
    console.error("Failed to delete customers:", delCustomersErr.message);
    process.exit(1);
  }

  console.log(`Deleted ${orderCountBefore} order(s).`);
  console.log(`Deleted ${customerCountBefore} customer(s).`);
  console.log(
    "Related data (assets, notifications, activity log, custom field values) removed via cascade."
  );
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
