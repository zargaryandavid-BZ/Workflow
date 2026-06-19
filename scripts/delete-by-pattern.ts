/**
 * Delete customers and orders matching a partial name/title pattern.
 *
 * Usage:
 *   npx tsx scripts/delete-by-pattern.ts "BZR test 5"
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

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

function textValue(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string"
    ? value
    : String(value).replace(/^"|"$/g, "");
}

function matchesPattern(text: string, pattern: string): boolean {
  return text.toLowerCase().includes(pattern.toLowerCase());
}

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars in .env.local");
    process.exit(1);
  }

  const pattern = process.argv[2]?.trim();
  if (!pattern) {
    console.error("Provide a search pattern, e.g. \"BZR test 5\"");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const likePattern = `%${pattern}%`;
  const orderIds = new Set<string>();
  const customerIds = new Set<string>();

  const { data: customers, error: custErr } = await supabase
    .from("customers")
    .select("id, name, email")
    .or(`name.ilike.${likePattern},email.ilike.${likePattern}`);
  if (custErr) throw new Error(custErr.message);
  for (const c of customers ?? []) customerIds.add(c.id);

  const { data: ordersByTitle, error: titleErr } = await supabase
    .from("orders")
    .select("id, title, customer_id")
    .ilike("title", likePattern);
  if (titleErr) throw new Error(titleErr.message);
  for (const o of ordersByTitle ?? []) {
    orderIds.add(o.id);
    if (o.customer_id) customerIds.add(o.customer_id);
  }

  const { data: ordersByDesc, error: descErr } = await supabase
    .from("orders")
    .select("id, title, customer_id")
    .ilike("description", likePattern);
  if (descErr) throw new Error(descErr.message);
  for (const o of ordersByDesc ?? []) {
    orderIds.add(o.id);
    if (o.customer_id) customerIds.add(o.customer_id);
  }

  if (customerIds.size > 0) {
    const { data: linkedOrders, error } = await supabase
      .from("orders")
      .select("id, title, customer_id")
      .in("customer_id", [...customerIds]);
    if (error) throw new Error(error.message);
    for (const o of linkedOrders ?? []) orderIds.add(o.id);
  }

  const { data: cfFields } = await supabase
    .from("custom_fields")
    .select("id, name")
    .in("name", ["Customer Name", "Customer Contact"]);

  const fieldIds = (cfFields ?? []).map((f) => f.id);
  if (fieldIds.length > 0) {
    const { data: vals, error } = await supabase
      .from("custom_field_values")
      .select("order_id, value, custom_field_id")
      .in("custom_field_id", fieldIds);
    if (error) throw new Error(error.message);
    for (const v of vals ?? []) {
      if (matchesPattern(textValue(v.value), pattern)) {
        orderIds.add(v.order_id);
      }
    }
  }

  // Re-resolve customers from matched orders
  if (orderIds.size > 0) {
    const { data: matchedOrders, error } = await supabase
      .from("orders")
      .select("customer_id")
      .in("id", [...orderIds]);
    if (error) throw new Error(error.message);
    for (const o of matchedOrders ?? []) {
      if (o.customer_id) customerIds.add(o.customer_id);
    }
  }

  console.log(`Pattern: "${pattern}"`);
  console.log("\nMatching customers:");
  if (customerIds.size === 0) {
    console.log("  (none)");
  } else {
    const { data: custRows } = await supabase
      .from("customers")
      .select("id, name, email")
      .in("id", [...customerIds]);
    for (const c of custRows ?? []) {
      console.log(`  - ${c.name} (${c.email ?? "no email"}) [${c.id}]`);
    }
  }

  console.log(`\nOrders to delete: ${orderIds.size}`);
  if (orderIds.size > 0) {
    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, title")
      .in("id", [...orderIds]);
    for (const o of orderRows ?? []) {
      console.log(`  - ${o.title} [${o.id}]`);
    }

    const { error } = await supabase
      .from("orders")
      .delete()
      .in("id", [...orderIds]);
    if (error) throw new Error(`Delete orders: ${error.message}`);
    console.log(`\nDeleted ${orderIds.size} order(s).`);
  }

  if (customerIds.size > 0) {
    const { error } = await supabase
      .from("customers")
      .delete()
      .in("id", [...customerIds]);
    if (error) throw new Error(`Delete customers: ${error.message}`);
    console.log(`Deleted ${customerIds.size} customer(s).`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
