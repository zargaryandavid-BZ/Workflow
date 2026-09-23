import "server-only";

import { isUnnamedPdfLayer, isPdfCutLineLayer, layersFromOptionalContent, mergePdfLayers, parsePdfOcgs, type OcLike, type PdfLayer } from "@/lib/pdf-ocg";
import { installPdfJsMapPolyfills } from "@/lib/pdfjs-map-polyfill";
import { initPdfjsNode, pdfjsNodeGetDocumentOptions } from "@/lib/pdfjs-node-assets";
import { wrapPdfJsCanvasFactory } from "@/lib/pdfjs-canvas-cap";
import { ocgOverlayRgba } from "@/lib/ocg-overlay-rgba";

type Ctx2D = {
  getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
  putImageData: (img: unknown, x: number, y: number) => void;
};

// Screen proofs only. Resolution is ADAPTIVE by source size: normal files
// render sharp, but very large (hundreds of MB / ~1GB) print PDFs render lighter
// so they still finish rasterizing inside the serverless time limit — otherwise
// the proof never pre-builds and the customer hits a live multi-minute build.
function proofResolution(sizeBytes: number): { maxEdge: number; dpi: number } {
  const mb = sizeBytes / (1024 * 1024);
  // dpi drives sharpness on SMALL physical items (a 3" label at 110dpi is only
  // ~330px and looks blocky); maxEdge caps large-format items so builds stay in
  // the serverless time limit. Small/normal files render at ~300dpi (a small
  // label comes out ~900px, crisp); only genuinely huge source PDFs drop down.
  if (mb >= 400) return { maxEdge: 1600, dpi: 150 };
  if (mb >= 150) return { maxEdge: 2200, dpi: 220 };
  return { maxEdge: 2600, dpi: 300 };
}

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

function applyVisibility(oc: OcConfig | null, layers: PdfLayer[], on: Set<string> | "print" | "none") {
  if (!oc) return;
  for (const layer of layers) {
    const vis =
      on === "print"
        ? !isPdfCutLineLayer(layer.name)
        : on === "none"
          ? false
          : on.has(layer.id);
    oc.setVisibility(layer.id, vis, false);
  }
}

/**
 * Rasterize selected PDF pages: one print composite PNG (Cut/dieline off,
 * same as the staff Artwork PDF view), plus a PNG per Acrobat layer.
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

  const { maxEdge: MAX_EDGE, dpi: TARGET_DPI } = proofResolution(input.length);

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

      const ocPromise = oc
        ? (Promise.resolve(oc) as Promise<
            import("pdfjs-dist/types/src/display/optional_content_config").OptionalContentConfig
          >)
        : undefined;

      const renderOnce = async (mode: "print" | "none" | Set<string>, opaque: boolean) => {
        applyVisibility(oc, allLayers, mode);
        const target = canvasFactory.create(width, height);
        try {
          await page.render({
            canvas: target.canvas as unknown as HTMLCanvasElement,
            canvasContext:
              target.context as unknown as CanvasRenderingContext2D,
            viewport,
            background: opaque ? "rgb(255,255,255)" : "rgba(0,0,0,0)",
            optionalContentConfigPromise: ocPromise,
          }).promise;
          return await pngFromCanvas(target.canvas);
        } finally {
          canvasFactory.destroy(target);
        }
      };

      // Render with a transparent background and return the raw RGBA pixels, so
      // the always-on base artwork can be subtracted out of each layer image.
      const renderRgba = async (mode: "print" | "none" | Set<string>) => {
        applyVisibility(oc, allLayers, mode);
        const target = canvasFactory.create(width, height);
        try {
          await page.render({
            canvas: target.canvas as unknown as HTMLCanvasElement,
            canvasContext:
              target.context as unknown as CanvasRenderingContext2D,
            viewport,
            background: "rgba(0,0,0,0)",
            optionalContentConfigPromise: ocPromise,
          }).promise;
          const ctx = target.context as unknown as Ctx2D;
          return new Uint8Array(ctx.getImageData(0, 0, width, height).data);
        } finally {
          canvasFactory.destroy(target);
        }
      };

      const encodeRgbaPng = async (rgba: Uint8Array): Promise<Buffer> => {
        const target = canvasFactory.create(width, height);
        try {
          const ctx = target.context as unknown as Ctx2D;
          ctx.putImageData(
            new ImageData(new Uint8ClampedArray(rgba), width, height) as unknown as object,
            0,
            0
          );
          return await pngFromCanvas(target.canvas);
        } finally {
          canvasFactory.destroy(target);
        }
      };

      const compositeJpg = await renderOnce("print", true);
      const layerPngs: Record<string, Buffer> = {};
      let basePng: Buffer = Buffer.from([]);

      if (layers.length > 0) {
        // Base = whatever stays on with every named layer OFF (the always-on
        // artwork). Each layer image is then ONLY the pixels that layer adds,
        // transparent everywhere else — so turning on dieline + foil + ...
        // stacks them all instead of the top opaque image hiding the ones below.
        const base = await renderRgba("none");
        basePng = await encodeRgbaPng(base);
        for (const layer of layers) {
          const full = await renderRgba(new Set([layer.id]));
          const delta = ocgOverlayRgba(full, base);
          layerPngs[layer.id] = await encodeRgbaPng(delta);
        }
      }

      out.push({
        page: pageNum,
        width,
        height,
        compositeJpg,
        basePng,
        layerPngs,
      });
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }

  return { layers, pages: out };
}
