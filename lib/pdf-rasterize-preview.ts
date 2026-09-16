import "server-only";

import { PDFDocument } from "pdf-lib";
import { pdfjsNodeGetDocumentOptions } from "@/lib/pdfjs-node-assets";
import { wrapPdfJsCanvasFactory } from "@/lib/pdfjs-canvas-cap";

const MAX_EDGE = 1400;
const JPEG_QUALITY = 68;
const TARGET_DPI = 150;

function jpegFromCanvas(canvas: {
  encode?: (format: string, quality?: number) => Promise<Buffer>;
  toBuffer?: (mime?: string) => Buffer;
}): Promise<Buffer> {
  if (typeof canvas.encode === "function") {
    return canvas.encode("jpeg", JPEG_QUALITY);
  }
  if (typeof canvas.toBuffer === "function") {
    return Promise.resolve(canvas.toBuffer("image/jpeg"));
  }
  throw new Error("canvas cannot encode jpeg");
}

/**
 * Flatten a print-ready PDF into preview-quality JPEG pages for a job ticket.
 * Layers and print resolution are discarded on purpose so the ticket stays small.
 */
export async function rasterizePdfForJobTicket(
  input: Buffer
): Promise<Buffer> {
  const { DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= DOMMatrix;
  g.ImageData ??= ImageData;
  g.Path2D ??= Path2D;

  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = Uint8Array.from(input);
  const loadingTask = getDocument(pdfjsNodeGetDocumentOptions(data));

  const pdf = await loadingTask.promise;
  const canvasFactory = wrapPdfJsCanvasFactory(
    (
      pdf as unknown as {
        canvasFactory: {
          create: (
            width: number,
            height: number
          ) => {
            canvas: {
              encode?: (format: string, quality?: number) => Promise<Buffer>;
              toBuffer?: (mime?: string) => Buffer;
              width: number;
              height: number;
            };
            context: unknown;
          };
          destroy: (target: { canvas: unknown; context: unknown }) => void;
        };
      }
    ).canvasFactory
  );

  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        TARGET_DPI / 72,
        MAX_EDGE / Math.max(base.width, 1),
        MAX_EDGE / Math.max(base.height, 1)
      );
      const viewport = page.getViewport({ scale: Math.max(scale, 0.15) });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const target = canvasFactory.create(width, height);
      try {
        await page.render({
          canvas: target.canvas as unknown as HTMLCanvasElement,
          canvasContext:
            target.context as unknown as CanvasRenderingContext2D,
          viewport,
          background: "rgb(255,255,255)",
        }).promise;
        const jpeg = await jpegFromCanvas(target.canvas);
        const image = await out.embedJpg(jpeg);
        const outPage = out.addPage([image.width, image.height]);
        outPage.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        });
      } finally {
        canvasFactory.destroy(target);
        page.cleanup();
      }
    }
  } finally {
    await pdf.cleanup();
  }

  if (out.getPageCount() === 0) {
    throw new Error("rasterize produced no pages");
  }
  return Buffer.from(await out.save({ useObjectStreams: true }));
}
