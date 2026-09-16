/** Skia cannot allocate print-PDF image bitmaps (e.g. 15ft flags at 150dpi). */

export const PDFJS_MAX_CANVAS_EDGE = 4096;
export const PDFJS_MAX_CANVAS_PIXELS = 4096 * 4096;

export function capCanvasDims(
  width: number,
  height: number
): { w: number; h: number; scaleX: number; scaleY: number } {
  const srcW = Math.max(1, Math.floor(width));
  const srcH = Math.max(1, Math.floor(height));
  const scale = Math.min(
    1,
    PDFJS_MAX_CANVAS_EDGE / srcW,
    PDFJS_MAX_CANVAS_EDGE / srcH,
    Math.sqrt(PDFJS_MAX_CANVAS_PIXELS / (srcW * srcH))
  );
  const w = Math.max(1, Math.floor(srcW * scale));
  const h = Math.max(1, Math.floor(srcH * scale));
  return { w, h, scaleX: w / srcW, scaleY: h / srcH };
}

type FactoryTarget = {
  canvas: unknown;
  context: {
    createImageData?: (w: number, h: number) => ImageData;
    putImageData?: (data: ImageData, x: number, y: number) => void;
  };
};

type CanvasFactoryLike = {
  create: (width: number, height: number) => FactoryTarget;
};

function downsampleImageData(
  src: ImageData,
  scaleX: number,
  scaleY: number,
  createImageData: (w: number, h: number) => ImageData
): ImageData {
  const dw = Math.max(1, Math.floor(src.width * scaleX));
  const dh = Math.max(1, Math.floor(src.height * scaleY));
  const dest = createImageData(dw, dh);
  const s = src.data;
  const d = dest.data;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scaleY));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scaleX));
      const si = (sy * src.width + sx) * 4;
      const di = (y * dw + x) * 4;
      d[di] = s[si];
      d[di + 1] = s[si + 1];
      d[di + 2] = s[si + 2];
      d[di + 3] = s[si + 3];
    }
  }
  return dest;
}

/** Shrink huge pdf.js scratch canvases and downsample putImageData to match. */
export function wrapPdfJsCanvasFactory<T extends CanvasFactoryLike>(factory: T): T {
  const origCreate = factory.create.bind(factory);
  factory.create = (width: number, height: number) => {
    const cap = capCanvasDims(width, height);
    const target = origCreate(cap.w, cap.h);
    if (cap.scaleX >= 0.999 && cap.scaleY >= 0.999) return target;
    const ctx = target.context;
    if (typeof ctx.putImageData !== "function" || typeof ctx.createImageData !== "function") {
      return target;
    }
    const origPut = ctx.putImageData.bind(ctx);
    const origCreateImageData = ctx.createImageData.bind(ctx);
    ctx.putImageData = (data: ImageData, x: number, y: number) => {
      if (data.width > cap.w + 1 || data.height > cap.h + 1) {
        const scaled = downsampleImageData(
          data,
          cap.scaleX,
          cap.scaleY,
          origCreateImageData
        );
        origPut(scaled, Math.floor(x * cap.scaleX), Math.floor(y * cap.scaleY));
        return;
      }
      origPut(data, Math.floor(x * cap.scaleX), Math.floor(y * cap.scaleY));
    };
    return target;
  };
  return factory;
}
