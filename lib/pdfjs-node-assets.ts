import { join } from "node:path";

/**
 * Filesystem dirs for pdf.js Node (`fs.readFile`) and API routes that serve
 * the same files. Do not use createRequire(import.meta.url).resolve —
 * Turbopack returns a numeric module id (e.g. 5102), and path.join throws.
 */
export function pdfjsDistRoot(): string {
  return join(process.cwd(), "node_modules", "pdfjs-dist");
}

export function pdfjsNodeAssetUrl(subdir: string): string {
  const dir = join(pdfjsDistRoot(), subdir);
  return `${dir.replace(/\\/g, "/")}/`;
}

/**
 * Configure pdfjs for Node.js server-side rendering.
 *
 * When pdfjs-dist is a serverExternalPackage (not bundled by Next.js), the
 * worker file exists at its real node_modules path. Point workerSrc there so
 * pdfjs can set up its fake-worker shim without a broken dynamic import.
 * Call this once before the first getDocument() call on each rasterize path.
 */
export async function initPdfjsNode(): Promise<void> {
  const { GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  // Point to the real worker file in node_modules so pdfjs can resolve it.
  // In Node.js, pdfjs never spawns a real thread — it uses its in-process
  // "fake worker" — but it still needs workerSrc set to a non-empty string.
  GlobalWorkerOptions.workerSrc = join(
    pdfjsDistRoot(),
    "legacy",
    "build",
    "pdf.worker.mjs"
  );
}

/** Shared getDocument() options for every Node rasterize path. */
export function pdfjsNodeGetDocumentOptions(data: Uint8Array) {
  return {
    data,
    cMapUrl: pdfjsNodeAssetUrl("cmaps"),
    cMapPacked: true as const,
    standardFontDataUrl: pdfjsNodeAssetUrl("standard_fonts"),
    wasmUrl: pdfjsNodeAssetUrl("wasm"),
    iccUrl: pdfjsNodeAssetUrl("iccs"),
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    verbosity: 0 as const,
  };
}
