/** Skia cannot allocate print-PDF image bitmaps (e.g. 15ft flags at 150dpi). */

// A too-low cap forces pdf.js to hand a large embedded image to our manual
// nearest-neighbor putImageData shrink, which drops rows periodically and shows
// up as evenly-spaced horizontal lines on the customer proof. Keep the cap high
// enough that normal artwork (well over 4096px) is scaled by pdf.js/skia in one
// smooth pass, while still protecting against genuinely enormous canvases
// (huge wide-format flags) that would blow up memory.
export const PDFJS_MAX_CANVAS_EDGE = 8192;
export const PDFJS_MAX_CANVAS_PIXELS = 40_000_000;

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

type PutImageContext = {
  createImageData?: (w: number, h: number) => ImageData;
  putImageData?: (data: ImageData, x: number, y: number) => void;
};

type CanvasFactoryLike = {
  create: (
    width: number,
    height: number
  ) => { canvas: unknown; context: unknown };
};

function asPutImageContext(context: unknown): PutImageContext | null {
  if (!context || typeof context !== "object") return null;
  return context as PutImageContext;
}

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
  const sw = src.width;
  const sh = src.height;
  // Box (area-average) downsample: every destination pixel averages ALL the
  // source pixels in its footprint. Only reached for canvases so large they had
  // to be capped; averaging (vs nearest-neighbor row-dropping) keeps even those
  // free of periodic seam lines.
  const invX = 1 / scaleX;
  const invY = 1 / scaleY;
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * invY);
    let sy1 = Math.floor((y + 1) * invY);
    if (sy1 <= sy0) sy1 = sy0 + 1;
    if (sy1 > sh) sy1 = sh;
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * invX);
      let sx1 = Math.floor((x + 1) * invX);
      if (sx1 <= sx0) sx1 = sx0 + 1;
      if (sx1 > sw) sx1 = sw;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        let si = (sy * sw + sx0) * 4;
        for (let sx = sx0; sx < sx1; sx++) {
          r += s[si];
          g += s[si + 1];
          b += s[si + 2];
          a += s[si + 3];
          si += 4;
          n += 1;
        }
      }
      const di = (y * dw + x) * 4;
      d[di] = (r / n + 0.5) | 0;
      d[di + 1] = (g / n + 0.5) | 0;
      d[di + 2] = (b / n + 0.5) | 0;
      d[di + 3] = (a / n + 0.5) | 0;
    }
  }
  return dest;
}

/** Shrink huge pdf.js scratch canvases and downsample putImageData to match. */
export function wrapPdfJsCanvasFactory<T extends CanvasFactoryLike>(factory: T): T {
  const origCreate = factory.create.bind(factory);
  factory.create = ((width: number, height: number) => {
    const cap = capCanvasDims(width, height);
    const target = origCreate(cap.w, cap.h);
    if (cap.scaleX >= 0.999 && cap.scaleY >= 0.999) return target;
    const ctx = asPutImageContext(target.context);
    if (
      !ctx ||
      typeof ctx.putImageData !== "function" ||
      typeof ctx.createImageData !== "function"
    ) {
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
  }) as T["create"];
  return factory;
}
