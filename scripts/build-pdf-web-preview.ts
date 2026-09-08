/**
 * Build a layer-preserving web preview in Drive for a huge print PDF.
 * JPEGs are downsampled; OCG layers are not flattened.
 *
 * Use this on your Mac for files over ~90 MB (Vercel cannot load 700 MB).
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs --env-file=.env.local scripts/build-pdf-web-preview.ts --fileId=DRIVE_FILE_ID
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
  return originalLoad.call(this, request, parent, isMain);
};

function argValue(flag: string): string {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? "" : "";
}

async function main() {
  const fileId = argValue("--fileId").trim();
  if (!fileId) {
    console.error("Pass --fileId=GOOGLE_DRIVE_FILE_ID");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { ensureGdriveSettings } = await import("../lib/gdrive-settings.ts");
  const { proofsDriveClient } = await import("../lib/gdrive-proofs.ts");
  const { resolveWebPreviewPdf } = await import("../lib/gdrive-pdf-preview.ts");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: tenants, error } = await sb.from("tenants").select("id").limit(1);
  if (error) throw error;
  const tenantId = tenants?.[0]?.id;
  if (!tenantId) throw new Error("No tenant");

  const settings = await ensureGdriveSettings(sb, tenantId);
  const client = proofsDriveClient(settings);
  console.log("Downloading and compressing (layers kept)…");
  const result = await resolveWebPreviewPdf(client, fileId, {
    force: true,
    sourceMaxBytes: 800 * 1024 * 1024,
  });
  if (!result) {
    console.error("Failed. Check the Drive file id and service-account access.");
    process.exit(1);
  }
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  console.log(
    `OK  ${result.name}  ${mb(result.size)} MB  preview=${result.preview ? "yes" : "no (already small)"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
