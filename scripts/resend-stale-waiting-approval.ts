/**
 * Resend customer approval for Waiting Approval jobs whose last communication
 * was 2+ days ago. Bumps notification created_at + Com. History.
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/resend-stale-waiting-approval.ts --dry-run
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/resend-stale-waiting-approval.ts
 */

import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { isWaitingApprovalColumn } from "../lib/waiting-approval-column.ts";
import type { JobNotification, Order } from "../lib/types.ts";

const originalLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const TENANT_ID = "e7f948cb-b4e2-4de6-808d-a0e87090d6f6";
const STALE_MS = 2 * 24 * 60 * 60 * 1000;
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

function loadableChannel(
  channel: string | null | undefined
): "email" | "sms" | "both" | null {
  if (channel === "email" || channel === "sms" || channel === "both") {
    return channel;
  }
  return null;
}

async function main() {
  loadEnvLocal();
  const { dispatchNotification, NOTIFICATION_TOKEN_TTL_MS } = await import(
    "../lib/notifications.ts"
  );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant } = await sb
    .from("tenants")
    .select("id, name")
    .eq("id", TENANT_ID)
    .maybeSingle();
  const tenantName = (tenant?.name as string | undefined)?.trim() || "Bazaar Printing";

  const { data: columns, error: colErr } = await sb
    .from("board_columns")
    .select("id, name, kind")
    .eq("tenant_id", TENANT_ID);
  if (colErr) throw new Error(colErr.message);
  const waitingIds = (columns ?? [])
    .filter((c) => isWaitingApprovalColumn(c))
    .map((c) => c.id);
  if (waitingIds.length === 0) throw new Error("No Waiting Approval column");

  const { data: orders, error: ordErr } = await sb
    .from("orders")
    .select("*, customer:customers(id, name, email, phone)")
    .eq("tenant_id", TENANT_ID)
    .in("column_id", waitingIds)
    .is("removed_at", null);
  if (ordErr) throw new Error(ordErr.message);

  const orderList = (orders ?? []) as Order[];
  const orderIds = orderList.map((o) => o.id);
  if (orderIds.length === 0) {
    console.log("No jobs in Waiting Approval.");
    return;
  }

  const { data: notes } = await sb
    .from("job_notifications")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .eq("type", "customer_approval")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });

  const { data: acts } = await sb
    .from("activity_log")
    .select("order_id, action, created_at")
    .eq("tenant_id", TENANT_ID)
    .in("order_id", orderIds)
    .eq("action", "customer_notified")
    .order("created_at", { ascending: false });

  const latestNoteByOrder = new Map<string, JobNotification>();
  for (const n of (notes ?? []) as JobNotification[]) {
    if (!latestNoteByOrder.has(n.order_id)) latestNoteByOrder.set(n.order_id, n);
  }
  const lastCommByOrder = new Map<string, number>();
  for (const n of (notes ?? []) as JobNotification[]) {
    if (n.status !== "sent") continue;
    const t = new Date(n.created_at).getTime();
    const prev = lastCommByOrder.get(n.order_id) ?? 0;
    if (t > prev) lastCommByOrder.set(n.order_id, t);
  }
  for (const a of acts ?? []) {
    if (!a.order_id || !a.created_at) continue;
    const t = new Date(a.created_at as string).getTime();
    const prev = lastCommByOrder.get(a.order_id) ?? 0;
    if (t > prev) lastCommByOrder.set(a.order_id, t);
  }

  const now = Date.now();
  const cutoff = now - STALE_MS;
  const stale = orderList
    .filter((o) => {
      const last = lastCommByOrder.get(o.id) ?? 0;
      return last <= cutoff;
    })
    .sort((a, b) =>
      String(a.title).localeCompare(String(b.title), undefined, { numeric: true })
    );

  console.log(
    `${DRY_RUN ? "DRY RUN " : ""}Waiting Approval: ${orderList.length} jobs, ${stale.length} stale (>= 2 days)`
  );

  const results: {
    title: string;
    last: string;
    channel: string;
    ok: boolean;
    error?: string;
  }[] = [];

  for (const order of stale) {
    const note = latestNoteByOrder.get(order.id);
    const lastMs = lastCommByOrder.get(order.id) ?? 0;
    const lastIso = lastMs ? new Date(lastMs).toISOString() : "never";
    const channel = loadableChannel(note?.channel);
    if (!note || note.status === "responded" || !channel) {
      results.push({
        title: String(order.title),
        last: lastIso,
        channel: note?.channel ?? "none",
        ok: false,
        error:
          !note
            ? "no approval notification"
            : note.status === "responded"
              ? "already responded"
              : `channel ${note?.channel ?? "none"} is not sendable`,
      });
      continue;
    }

    if (DRY_RUN) {
      results.push({
        title: String(order.title),
        last: lastIso,
        channel,
        ok: true,
      });
      continue;
    }

    try {
      const expiresAt = new Date(Date.now() + NOTIFICATION_TOKEN_TTL_MS).toISOString();
      await sb
        .from("job_notifications")
        .update({ token_expires_at: expiresAt })
        .eq("id", note.id)
        .eq("tenant_id", TENANT_ID);

      await dispatchNotification(sb, {
        notification: note,
        order,
        tenantName,
        channel,
      });
      results.push({
        title: String(order.title),
        last: lastIso,
        channel,
        ok: true,
      });
      console.log(`sent ${order.title} (${channel}) last=${lastIso}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        title: String(order.title),
        last: lastIso,
        channel,
        ok: false,
        error,
      });
      console.error(`fail ${order.title}: ${error}`);
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ sent, failed: failed.length, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
