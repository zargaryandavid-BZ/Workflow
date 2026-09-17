/**
 * Rasterize Final PDFs into customer proof pictures for every Waiting Approval
 * job (and any open customer_approval notification).
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/generate-waiting-approval-previews.ts
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/generate-waiting-approval-previews.ts 15155-1
 */
import { readFileSync } from "node:fs";
import { Module } from "node:module";
import { resolve } from "node:path";

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
  return originalLoad(request, parent, isMain);
};

async function main() {
  const needle = (process.argv[2] ?? "").trim();
  if (needle) {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase env");
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: order, error } = await sb
      .from("orders")
      .select("id, title, tenant_id, specs")
      .ilike("title", `%${needle}%`)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error(`No order matching ${needle}`);
    const { skusForRespond } = await import("../lib/respond-order.ts");
    const { fetchRespondArtworkPack } = await import(
      "../lib/respond-final-pdf.ts"
    );
    const specs = (order.specs ?? {}) as Record<string, unknown>;
    const ticket = skusForRespond(specs);
    const pack = await fetchRespondArtworkPack(
      sb,
      order.tenant_id as string,
      {
        id: order.id as string,
        title: String(order.title ?? ""),
        specs,
      },
      ticket
    );
    const sample = Object.values(pack.bySku)[0];
    console.log(
      `Drive pack ticketSkus=${ticket.length} aligned=${pack.skus.length} pdfs=${Object.keys(pack.bySku).length}` +
        (sample ? ` file=${sample.fileName} id=${sample.fileId}` : "")
    );
    const {
      loadRespondPreviewIndex,
      generateApprovalLayerPreviewsForOrder,
    } = await import("../lib/approval-layer-previews.ts");
    const stored = await loadRespondPreviewIndex(order.id as string);
    console.log(
      stored
        ? `stored ${order.title} pages=${stored.pages?.length ?? 0} skus=${Object.keys(stored.bySku || {}).length}`
        : `no stored index for ${order.title}`
    );
    const started = Date.now();
    const previews = await generateApprovalLayerPreviewsForOrder({
      id: order.id as string,
      title: String(order.title ?? ""),
      tenant_id: order.tenant_id as string,
      specs: (order.specs ?? {}) as never,
    });
    console.log(
      `OK ${order.title} ${Object.keys(previews).length} SKUs ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
    return;
  }

  const { generateApprovalLayerPreviewsForWaitingOrders } = await import(
    "../lib/approval-layer-previews.ts"
  );
  const results = await generateApprovalLayerPreviewsForWaitingOrders();
  console.log(`checked ${results.length} waiting/open approval jobs`);
  for (const row of results) {
    if (row.error) console.log(`FAIL ${row.title}: ${row.error}`);
    else console.log(`OK   ${row.title} (${row.skus} SKUs)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
