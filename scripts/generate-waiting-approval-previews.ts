/**
 * Rasterize Final PDFs into customer proof pictures for every Waiting Approval
 * job (and any open customer_approval notification).
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/generate-waiting-approval-previews.ts
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
