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
 * Disable the pdf.js worker in Node.js contexts.
 *
 * pdfjs-dist defaults to loading pdf.worker.mjs via a dynamic import whose
 * resolved path breaks inside the Next.js server bundle. In Node.js we don't
 * need a real Web Worker — setting workerSrc to an empty string tells pdfjs to
 * run the worker logic in-thread (the "fake worker" mode) without trying to
 * load an external file. Call this once before the first getDocument() call.
 */
export async function initPdfjsNode(): Promise<void> {
  const { GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  GlobalWorkerOptions.workerSrc = "";
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
