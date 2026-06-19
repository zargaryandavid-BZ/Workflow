/**
 * Delete customers and their orders by name and/or email.
 *
 * Usage:
 *   npx tsx scripts/delete-customers-by-criteria.ts "Customer Name" "email@example.com"
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

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env vars in .env.local");
    process.exit(1);
  }

  const nameQuery = process.argv[2]?.trim();
  const emailQuery = process.argv[3]?.trim();
  if (!nameQuery && !emailQuery) {
    console.error("Provide at least one of: customer name, email");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const customers: { id: string; name: string; email: string | null }[] = [];

  if (nameQuery) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email")
      .ilike("name", nameQuery);
    if (error) throw new Error(error.message);
    customers.push(...(data ?? []));
  }

  if (emailQuery) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email")
      .ilike("email", emailQuery);
    if (error) throw new Error(error.message);
    customers.push(...(data ?? []));
  }

  const customerIds = [...new Set(customers.map((c) => c.id))];
  const orderIds = new Set<string>();

  if (customerIds.length > 0) {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, title")
      .in("customer_id", customerIds);
    if (error) throw new Error(error.message);
    for (const o of orders ?? []) orderIds.add(o.id);
  }

  const { data: cfFields } = await supabase
    .from("custom_fields")
    .select("id, name")
    .in("name", ["Customer Name", "Customer Contact"]);

  const nameFieldIds = (cfFields ?? [])
    .filter((f) => f.name === "Customer Name")
    .map((f) => f.id);
  const contactFieldIds = (cfFields ?? [])
    .filter((f) => f.name === "Customer Contact")
    .map((f) => f.id);

  function valueMatches(value: unknown, query: string): boolean {
    if (value == null) return false;
    const text =
      typeof value === "string" ? value : String(value).replace(/^"|"$/g, "");
    return text.toLowerCase() === query.toLowerCase();
  }

  if (nameQuery && nameFieldIds.length > 0) {
    const { data: vals, error } = await supabase
      .from("custom_field_values")
      .select("order_id, value")
      .in("custom_field_id", nameFieldIds);
    if (error) throw new Error(error.message);
    for (const v of vals ?? []) {
      if (valueMatches(v.value, nameQuery)) orderIds.add(v.order_id);
    }
  }

  if (emailQuery && contactFieldIds.length > 0) {
    const { data: vals, error } = await supabase
      .from("custom_field_values")
      .select("order_id, value")
      .in("custom_field_id", contactFieldIds);
    if (error) throw new Error(error.message);
    for (const v of vals ?? []) {
      if (valueMatches(v.value, emailQuery)) orderIds.add(v.order_id);
    }
  }

  console.log("Matching customers:");
  for (const c of customers) {
    console.log(`  - ${c.name} (${c.email ?? "no email"}) [${c.id}]`);
  }
  if (customers.length === 0) console.log("  (none in customers table)");

  console.log(`Orders to delete: ${orderIds.size}`);
  if (orderIds.size > 0) {
    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, title")
      .in("id", [...orderIds]);
    for (const o of orderRows ?? []) {
      console.log(`  - ${o.title} [${o.id}]`);
    }
  }

  if (orderIds.size > 0) {
    const { error } = await supabase
      .from("orders")
      .delete()
      .in("id", [...orderIds]);
    if (error) throw new Error(`Delete orders: ${error.message}`);
    console.log(`Deleted ${orderIds.size} order(s).`);
  }

  if (customerIds.length > 0) {
    const { error } = await supabase
      .from("customers")
      .delete()
      .in("id", customerIds);
    if (error) throw new Error(`Delete customers: ${error.message}`);
    console.log(`Deleted ${customerIds.length} customer(s).`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
