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
