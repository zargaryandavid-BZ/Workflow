/**
 * Create a customer_approval row (no email) and print a localhost /respond link.
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/create-local-respond-link.ts 15166-1
 */
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Order } from "../lib/types.ts";

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
  const needle = (process.argv[2] ?? "15166-1").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: order, error } = await sb
    .from("orders")
    .select("*")
    .ilike("title", `%${needle}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order) throw new Error(`No order matching ${needle}`);

  if (process.argv.includes("--previews")) {
    const { generateApprovalLayerPreviewsForOrder } = await import(
      "../lib/approval-layer-previews.ts"
    );
    console.log("Building layer preview images…");
    const previews = await generateApprovalLayerPreviewsForOrder(order as Order);
    console.log(`layer SKUs ${Object.keys(previews).length}`);
  }

  const { data: existing } = await sb
    .from("job_notifications")
    .select("token, status")
    .eq("order_id", order.id)
    .eq("type", "customer_approval")
    .neq("status", "expired")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const token = existing?.token as string | undefined;
  const local = token
    ? `http://localhost:3000/respond/${token}`
    : "(no open approval — run with a new Request approval)";
  console.log(`order ${order.title}`);
  console.log(`local ${local}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
