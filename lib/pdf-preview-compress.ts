import "server-only";

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import sharp from "sharp";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 72;

function filterNames(value: unknown): string[] {
  if (!value) return [];
  if (value instanceof PDFName) {
    return [value.asString().replace(/^\//, "")];
  }
  if (value instanceof PDFArray) {
    const out: string[] = [];
    for (let i = 0; i < value.size(); i++) {
      const item = value.get(i);
      if (item instanceof PDFName) {
        out.push(item.asString().replace(/^\//, ""));
      }
    }
    return out;
  }
  return [];
}

function isJpegImageStream(dict: PDFDict): boolean {
  const subtype = dict.get(PDFName.of("Subtype"));
  const isImage =
    subtype instanceof PDFName && subtype.asString() === "/Image";
  const filters = filterNames(dict.get(PDFName.of("Filter")));
  return isImage && filters.includes("DCTDecode");
}

/**
 * Shrink embedded JPEGs. Optional-content groups (layers) stay intact because
 * we only replace image streams — we do not flatten or rewrite page operators.
 */
export async function compressPdfKeepLayers(
  input: Buffer
): Promise<{ buffer: Buffer; imagesRecompressed: number }> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  let imagesRecompressed = 0;

  for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (!isJpegImageStream(obj.dict)) continue;

    let decoded: Uint8Array;
    try {
      decoded = decodePDFRawStream(obj).decode();
    } catch {
      continue;
    }
    if (decoded.byteLength < 8) continue;

    try {
      const next = await sharp(Buffer.from(decoded))
        .rotate()
        .resize({
          width: MAX_EDGE,
          height: MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
      if (next.byteLength >= decoded.byteLength * 0.95) continue;

      const dict = obj.dict.clone(pdf.context);
      dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      dict.set(PDFName.Length, PDFNumber.of(next.byteLength));
      dict.delete(PDFName.of("DecodeParms"));
      dict.delete(PDFName.of("DP"));
      pdf.context.assign(ref, PDFRawStream.of(dict, next));
      imagesRecompressed += 1;
    } catch {
      /* skip this image */
    }
  }

  const saved = await pdf.save({ useObjectStreams: true });
  return { buffer: Buffer.from(saved), imagesRecompressed };
}
