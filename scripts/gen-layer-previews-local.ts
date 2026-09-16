/**
 * Rasterize a Final PDF into the same layer preview images /respond uses.
 *
 *   npx tsx --import ./scripts/fedex/register-server-only.mjs scripts/gen-layer-previews-local.ts 15166-1
 *
 * Opens nothing automatically. Open tmp/layer-previews/index.html in a browser.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Module } from "node:module";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function sanitizeLayerPreviewKey(id: string): string {
  return (id.trim() || "layer").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

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
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* .env.local optional when flags already set */
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

const needle = (process.argv[2] ?? "15166-1").trim();
const outDir = resolve(process.cwd(), "tmp/layer-previews");

function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

async function main() {
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
  const { downloadUniqueFinalPdfBuffers, fetchRespondArtworkPack } =
    await import("../lib/respond-final-pdf.ts");
  const { rasterizePdfLayerPreviews } = await import(
    "../lib/pdf-layer-preview.ts"
  );

  const specs = (order.specs ?? {}) as Record<string, unknown>;
  const pack = await fetchRespondArtworkPack(
    sb,
    order.tenant_id as string,
    {
      id: order.id as string,
      title: String(order.title ?? ""),
      specs,
    },
    skusForRespond(specs)
  );
  const pages = [
    ...new Set(
      Object.values(pack.bySku)
        .map((p) => p.page ?? 1)
        .filter((n) => n >= 1)
    ),
  ]
    .sort((a, b) => a - b)
    .slice(0, 2);

  console.log(`Order ${order.title} (${order.id})`);
  console.log(`SKU pages to preview: ${pages.join(", ") || "1"}`);

  const buffers = await downloadUniqueFinalPdfBuffers(
    sb,
    order.tenant_id as string,
    {
      id: order.id as string,
      title: String(order.title ?? ""),
      specs,
    },
    skusForRespond(specs)
  );
  if (buffers.length === 0) throw new Error("No Final PDF downloaded");
  const pdf = buffers[0]!;
  console.log(`Downloaded Final PDF ${mb(pdf.byteLength)}`);

  const want = pages.length > 0 ? pages : [1];
  console.log("Rasterizing layers (this can take a few minutes)…");
  const started = Date.now();
  const raster = await rasterizePdfLayerPreviews(pdf, want);
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${raster.layers.length} layers, ${raster.pages.length} page(s)`
  );
  for (const layer of raster.layers) {
    console.log(`  layer ${layer.id}  ${layer.name}`);
  }

  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const page of raster.pages) {
    const prefix = `p${page.page}`;
    const composite = `${prefix}-composite.jpg`;
    writeFileSync(resolve(outDir, composite), page.compositeJpg);
    files.push(
      `${composite} ${mb(page.compositeJpg.byteLength)} ${page.width}x${page.height}`
    );
    if (page.basePng.length) {
      const base = `${prefix}-base.png`;
      writeFileSync(resolve(outDir, base), page.basePng);
      files.push(`${base} ${mb(page.basePng.byteLength)}`);
    }
    for (const [id, png] of Object.entries(page.layerPngs)) {
      const name = `${prefix}-layer-${sanitizeLayerPreviewKey(id)}.png`;
      writeFileSync(resolve(outDir, name), png);
      files.push(`${name} ${mb(png.byteLength)} (${id})`);
    }
  }

  const first = raster.pages[0]!;
  const layerInputs = raster.layers
    .map((layer) => {
      const src = `p${first.page}-layer-${sanitizeLayerPreviewKey(layer.id)}.png`;
      return `<label><input type="checkbox" checked data-layer="${htmlEscape(src)}"> ${htmlEscape(layer.name)}</label>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Layer previews — ${htmlEscape(String(order.title))}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; background: #f8fafc; color: #0f172a; }
    .stack { position: relative; width: min(420px, 100%); background: white; border: 1px solid #e2e8f0; }
    .stack img { display: block; width: 100%; height: auto; }
    .stack img.overlay { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    label { margin-right: 12px; display: inline-flex; gap: 6px; align-items: center; }
    .meta { font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <h1>SEE LAYERS preview</h1>
  <p class="meta">${htmlEscape(String(order.title))} · page ${first.page} · ${raster.layers.length} layers</p>
  <p>
    <label><input type="checkbox" id="all" checked> ALL</label>
    ${layerInputs}
  </p>
  <div class="stack">
    <img id="base" src="p${first.page}-base.png" alt="base" />
    ${raster.layers
      .map(
        (layer) =>
          `<img class="overlay" data-src="p${first.page}-layer-${sanitizeLayerPreviewKey(layer.id)}.png" src="p${first.page}-layer-${sanitizeLayerPreviewKey(layer.id)}.png" alt="${htmlEscape(layer.name)}" />`
      )
      .join("\n")}
    <img id="composite" src="p${first.page}-composite.jpg" alt="all layers" />
  </div>
  <script>
    const overlays = [...document.querySelectorAll(".overlay")];
    const boxes = [...document.querySelectorAll("input[data-layer]")];
    const all = document.getElementById("all");
    const composite = document.getElementById("composite");
    const base = document.getElementById("base");
    function sync() {
      const every = boxes.length === 0 || boxes.every((b) => b.checked);
      all.checked = every;
      composite.style.display = every ? "block" : "none";
      base.style.display = every ? "none" : "block";
      overlays.forEach((img) => {
        const box = boxes.find((b) => b.dataset.layer === img.dataset.src);
        img.style.display = every ? "none" : box?.checked ? "block" : "none";
      });
    }
    all.addEventListener("change", () => {
      boxes.forEach((b) => { b.checked = all.checked; });
      sync();
    });
    boxes.forEach((b) => b.addEventListener("change", sync));
    sync();
  </script>
</body>
</html>
`;
  writeFileSync(resolve(outDir, "index.html"), html);
  console.log(`Wrote ${outDir}`);
  for (const line of files) console.log(`  ${line}`);
  console.log(`Open: ${resolve(outDir, "index.html")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
