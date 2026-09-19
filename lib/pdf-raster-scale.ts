/** Job-ticket JPEG pages: sharp enough for dielines, still under the 4096 canvas cap. */
export const JOB_TICKET_RASTER_MAX_EDGE = 2800;
export const JOB_TICKET_RASTER_DPI = 220;
export const JOB_TICKET_JPEG_QUALITY = 90;

export function rasterScaleForPdfPage(
  pageWidthPt: number,
  pageHeightPt: number,
  opts: { maxEdge: number; targetDpi: number; minScale?: number }
): number {
  const scale = Math.min(
    opts.targetDpi / 72,
    opts.maxEdge / Math.max(pageWidthPt, 1),
    opts.maxEdge / Math.max(pageHeightPt, 1)
  );
  return Math.max(scale, opts.minScale ?? 0.15);
}
