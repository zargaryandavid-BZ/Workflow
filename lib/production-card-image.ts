/** Kanban card picture written from the Final PDF proof / Drive thumbnail. */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const PRODUCTION_CARD_FILES = [
  "final-production.png",
  "final-production.jpg",
] as const;

export type ProductionCardImageMeta = {
  fileName: (typeof PRODUCTION_CARD_FILES)[number];
  contentType: "image/png" | "image/jpeg";
};

/** Raster composites are PNG; Drive thumbnails are JPEG. Label by magic bytes. */
export function productionCardImageMeta(bytes: Buffer): ProductionCardImageMeta {
  if (bytes.length >= PNG_SIG.length && bytes.subarray(0, PNG_SIG.length).equals(PNG_SIG)) {
    return { fileName: "final-production.png", contentType: "image/png" };
  }
  return { fileName: "final-production.jpg", contentType: "image/jpeg" };
}
