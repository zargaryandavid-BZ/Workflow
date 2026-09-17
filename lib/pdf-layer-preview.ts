import "server-only";

import { isUnnamedPdfLayer, layersFromOptionalContent, mergePdfLayers, parsePdfOcgs, type OcLike, type PdfLayer } from "@/lib/pdf-ocg";
import { installPdfJsMapPolyfills } from "@/lib/pdfjs-map-polyfill";
import { initPdfjsNode, pdfjsNodeGetDocumentOptions } from "@/lib/pdfjs-node-assets";
import { wrapPdfJsCanvasFactory } from "@/lib/pdfjs-canvas-cap";

const MAX_EDGE = 1400;   // medium-quality: fits a 1400-px wide proof image
const JPEG_QUALITY = 78; // medium quality — good for screen review
const TARGET_DPI = 110;  // matches a typical PDF viewer at 100 %

type NodeCanvas = {
  encode?: (format: string, quality?: number) => Promise<Buffer>;
  toBuffer?: (mime?: string) => Buffer;
  width: number;
  height: number;
};

type CanvasFactory = {
  create: (
    width: number,
    height: number
  ) => { canvas: NodeCanvas; context: unknown };
  destroy: (target: { canvas: unknown; context: unknown }) => void;
};

type OcConfig = OcLike & {
  setVisibility: (id: string, visible: boolean, preserveRB?: boolean) => void;
};

export type RasterizedLayerPage = {
  page: number;
  width: number;
  height: number;
  compositeJpg: Buffer;
  basePng: Buffer;
  layerPngs: Record<string, Buffer>;
};

export type RasterizedLayerPreview = {
  layers: PdfLayer[];
  pages: RasterizedLayerPage[];
};

async function pngFromCanvas(canvas: NodeCanvas): Promise<Buffer> {
  if (typeof canvas.encode === "function") {
    return canvas.encode("png");
  }
  if (typeof canvas.toBuffer === "function") {
    return Promise.resolve(canvas.toBuffer("image/png"));
  }
  throw new Error("canvas cannot encode png");
}

async function jpegFromCanvas(canvas: NodeCanvas): Promise<Buffer> {
  if (typeof canvas.encode === "function") {
    return canvas.encode("jpeg", JPEG_QUALITY);
  }
  if (typeof canvas.toBuffer === "function") {
    return Promise.resolve(canvas.toBuffer("image/jpeg"));
  }
  throw new Error("canvas cannot encode jpeg");
}

function applyVisibility(oc: OcConfig | null, layers: PdfLayer[], on: Set<string> | "all" | "none") {
  if (!oc) return;
  for (const layer of layers) {
    const vis =
      on === "all" ? true : on === "none" ? false : on.has(layer.id);
    oc.setVisibility(layer.id, vis, false);
  }
}

/**
 * Rasterize selected PDF pages: one composite JPEG, a base (all OCGs off),
 * and a transparent PNG per Acrobat layer for SEE LAYERS stacking.
 */
export async function rasterizePdfLayerPreviews(
  input: Buffer,
  pages: number[]
): Promise<RasterizedLayerPreview> {
  installPdfJsMapPolyfills();
  const { DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= DOMMatrix;
  g.ImageData ??= ImageData;
  g.Path2D ??= Path2D;

  await initPdfjsNode();
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = Uint8Array.from(input);
  const loadingTask = getDocument(pdfjsNodeGetDocumentOptions(data));

  const pdf = await loadingTask.promise;
  const canvasFactory = wrapPdfJsCanvasFactory(
    (
      pdf as unknown as { canvasFactory: CanvasFactory }
    ).canvasFactory
  );

  let oc: OcConfig | null = null;
  try {
    oc = (await pdf.getOptionalContentConfig()) as OcConfig | null;
  } catch {
    oc = null;
  }

  const fromOc = oc ? layersFromOptionalContent(oc) : [];
  const allLayers = mergePdfLayers(fromOc, parsePdfOcgs(data.buffer as ArrayBuffer));
  const layers = allLayers.filter((layer) => !isUnnamedPdfLayer(layer.name));

  const wanted = [
    ...new Set(
      pages
        .map((n) => Math.floor(n))
        .filter((n) => n >= 1 && n <= pdf.numPages)
    ),
  ].sort((a, b) => a - b);
  const pageList = wanted.length > 0 ? wanted : [1];

  const out: RasterizedLayerPage[] = [];
  try {
    for (const pageNum of pageList) {
      console.warn(
        `[layer-preview] rasterize page ${pageNum}/${pageList.length}`
      );
      const page = await pdf.getPage(pageNum);
      const baseVp = page.getViewport({ scale: 1 });
      const scale = Math.min(
        TARGET_DPI / 72,
        MAX_EDGE / Math.max(baseVp.width, 1),
        MAX_EDGE / Math.max(baseVp.height, 1)
      );
      const viewport = page.getViewport({ scale: Math.max(scale, 0.12) });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));

      const renderOnce = async (mode: "all" | "none" | Set<string>, opaque: boolean) => {
        applyVisibility(oc, allLayers, mode);
        const target = canvasFactory.create(width, height);
        try {
          await page.render({
            canvas: target.canvas as unknown as HTMLCanvasElement,
            canvasContext:
              target.context as unknown as CanvasRenderingContext2D,
            viewport,
            background: opaque ? "rgb(255,255,255)" : "rgba(0,0,0,0)",
            optionalContentConfigPromise: oc
              ? (Promise.resolve(oc) as Promise<
                  import("pdfjs-dist/types/src/display/optional_content_config").OptionalContentConfig
                >)
              : undefined,
          }).promise;
          return opaque
            ? await jpegFromCanvas(target.canvas)
            : await pngFromCanvas(target.canvas);
        } finally {
          canvasFactory.destroy(target);
        }
      };

      const compositeJpg = await renderOnce("all", true);
      const layerPngs: Record<string, Buffer> = {};

      if (layers.length > 0) {
        for (const layer of layers) {
          layerPngs[layer.id] = await renderOnce(new Set([layer.id]), true);
        }
      }

      out.push({
        page: pageNum,
        width,
        height,
        compositeJpg,
        basePng: Buffer.from([]),
        layerPngs,
      });
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }

  return { layers, pages: out };
}
