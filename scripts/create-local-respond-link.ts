/**
 * Create a customer_approval row (no email) and print a localhost /respond link.
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/create-local-respond-link.ts 15166-1
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/create-local-respond-link.ts 15231-1 --new
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

  const forceNew =
    process.argv.includes("--new") || process.argv.includes("--create");
  const wantPreviews = forceNew || process.argv.includes("--previews");

  if (wantPreviews) {
    const { generateApprovalLayerPreviewsForOrder } = await import(
      "../lib/approval-layer-previews.ts"
    );
    console.log("Building layer preview images…");
    const previews = await generateApprovalLayerPreviewsForOrder(order as Order);
    console.log(`layer SKUs ${Object.keys(previews).length}`);
  }

  const { data: waitingCol } = await sb
    .from("columns")
    .select("id, name")
    .eq("tenant_id", order.tenant_id)
    .ilike("name", "%waiting%approval%")
    .limit(1)
    .maybeSingle();
  if (waitingCol?.id && order.column_id !== waitingCol.id) {
    const { error: moveErr } = await sb
      .from("orders")
      .update({ column_id: waitingCol.id })
      .eq("id", order.id);
    if (moveErr) throw new Error(moveErr.message);
    console.log(`moved to ${waitingCol.name}`);
  }

  let token: string | undefined;
  if (!forceNew) {
    const { data: existing } = await sb
      .from("job_notifications")
      .select("token, status")
      .eq("order_id", order.id)
      .eq("type", "customer_approval")
      .neq("status", "expired")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    token = existing?.token as string | undefined;
  }

  if (!token) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: created, error: createErr } = await sb
      .from("job_notifications")
      .insert({
        tenant_id: order.tenant_id,
        order_id: order.id,
        type: "customer_approval",
        channel: "none",
        token_expires_at: expiresAt,
        staff_note: "Local waiting approval (no email)",
        status: "sent",
        column_id: waitingCol?.id ?? order.column_id ?? null,
      })
      .select("id, token")
      .single();
    if (createErr) throw new Error(createErr.message);
    token = created.token as string;
    await sb
      .from("job_notifications")
      .update({ status: "expired" })
      .eq("order_id", order.id)
      .eq("type", "customer_approval")
      .in("status", ["pending", "sent"])
      .neq("id", created.id);
  }

  const local = `http://localhost:3000/respond/${token}`;
  console.log(`order ${order.title}`);
  console.log(`local ${local}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
