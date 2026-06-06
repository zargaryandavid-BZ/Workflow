/**
 * Merges duplicate customer rows that share the same email or phone within a tenant.
 * Does NOT merge unrelated email-only + phone-only records (that requires both
 * contacts in a single upsert).
 *
 * Usage: npm run merge-duplicate-customers
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

type CustomerRow = {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  created_at: string;
};

function dataScore(c: CustomerRow): number {
  let score = 0;
  if (c.name?.trim()) score += 1;
  if (c.email) score += 1;
  if (c.phone) score += 1;
  if (c.company) score += 1;
  return score;
}

async function orderCount(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string
): Promise<number> {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  return count ?? 0;
}

async function mergePair(
  supabase: SupabaseClient,
  tenantId: string,
  winner: CustomerRow,
  loser: CustomerRow
) {
  console.log(
    `  Merging "${loser.name}" (${loser.id}) → "${winner.name}" (${winner.id})`
  );

  const updates: Record<string, string | null> = {};
  if (!winner.email && loser.email) updates.email = loser.email;
  if (!winner.phone && loser.phone) updates.phone = loser.phone;
  if (!winner.name?.trim() && loser.name?.trim()) updates.name = loser.name;
  if (!winner.company && loser.company) updates.company = loser.company;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("customers")
      .update(updates)
      .eq("id", winner.id);
    if (error) throw new Error(error.message);
  }

  const { error: orderError } = await supabase
    .from("orders")
    .update({ customer_id: winner.id })
    .eq("tenant_id", tenantId)
    .eq("customer_id", loser.id);
  if (orderError) throw new Error(orderError.message);

  const { error: deleteError } = await supabase
    .from("customers")
    .delete()
    .eq("id", loser.id);
  if (deleteError) throw new Error(deleteError.message);
}

async function mergeByField(
  supabase: SupabaseClient,
  tenantId: string,
  customers: CustomerRow[],
  field: "email" | "phone"
) {
  const groups = new Map<string, CustomerRow[]>();
  for (const c of customers) {
    const value = c[field];
    if (!value) continue;
    const list = groups.get(value) ?? [];
    list.push(c);
    groups.set(value, list);
  }

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    const scored = await Promise.all(
      group.map(async (c) => ({
        customer: c,
        orders: await orderCount(supabase, tenantId, c.id),
        score: dataScore(c),
      }))
    );
    scored.sort((a, b) => {
      if (b.orders !== a.orders) return b.orders - a.orders;
      if (b.score !== a.score) return b.score - a.score;
      return a.customer.created_at.localeCompare(b.customer.created_at);
    });

    const winner = scored[0]!.customer;
    for (let i = 1; i < scored.length; i++) {
      await mergePair(supabase, tenantId, winner, scored[i]!.customer);
      const idx = customers.findIndex((c) => c.id === scored[i]!.customer.id);
      if (idx >= 0) customers.splice(idx, 1);
    }
  }
}

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .order("tenant_id")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const byTenant = new Map<string, CustomerRow[]>();
  for (const row of (customers ?? []) as CustomerRow[]) {
    const list = byTenant.get(row.tenant_id) ?? [];
    list.push(row);
    byTenant.set(row.tenant_id, list);
  }

  for (const [tenantId, tenantCustomers] of byTenant) {
    console.log(`Tenant ${tenantId}: ${tenantCustomers.length} customers`);
    await mergeByField(supabase, tenantId, tenantCustomers, "email");
    await mergeByField(supabase, tenantId, tenantCustomers, "phone");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
