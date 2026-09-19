import "server-only";

import { deflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_JPEG_QUALITY = 72;
const JOB_TICKET_MAX_EDGE = 2200;
const JOB_TICKET_JPEG_QUALITY = 82;

type SharpInstance = {
  rotate: () => SharpInstance;
  resize: (opts: {
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: boolean;
  }) => SharpInstance;
  jpeg: (opts: { quality: number; mozjpeg: boolean }) => SharpInstance;
  toBuffer: (opts: {
    resolveWithObject: true;
  }) => Promise<{ data: Buffer; info: { width: number; height: number } }>;
};

type SharpFn = (
  input: Buffer,
  opts?: { raw?: { width: number; height: number; channels: 1 | 3 | 4 } }
) => SharpInstance;

export type CompressPdfOptions = {
  maxEdge?: number;
  jpegQuality?: number;
  /** Also recompress FlateDecode RGB/Gray/CMYK images (job tickets). */
  recompressFlate?: boolean;
  /** Flate-compress uncompressed content streams (print PDFs often store these raw). */
  deflateUnfiltered?: boolean;
};

let sharpLoader: Promise<SharpFn | null> | null = null;

function loadSharp(): Promise<SharpFn | null> {
  if (!sharpLoader) {
    sharpLoader = import("sharp")
      .then((mod) => (mod.default ?? mod) as SharpFn)
      .catch((err: unknown) => {
        console.error(
          "[pdf-preview] sharp unavailable; serving original PDF",
          err instanceof Error ? err.message : err
        );
        return null;
      });
  }
  return sharpLoader;
}

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

function dictNumber(dict: PDFDict, name: string): number | null {
  const v = dict.get(PDFName.of(name));
  if (v instanceof PDFNumber) return v.asNumber();
  return null;
}

function isImageXObject(dict: PDFDict): boolean {
  const subtype = dict.get(PDFName.of("Subtype"));
  return subtype instanceof PDFName && subtype.asString() === "/Image";
}

function rawChannels(dict: PDFDict): 1 | 3 | 4 | null {
  const cs = dict.get(PDFName.of("ColorSpace"));
  if (!(cs instanceof PDFName)) return null;
  const name = cs.asString();
  if (name === "/DeviceGray") return 1;
  if (name === "/DeviceRGB") return 3;
  if (name === "/DeviceCMYK") return 4;
  return null;
}

function deflateUnfilteredStreams(pdf: PDFDocument): number {
  const updates: { ref: PDFRawStream extends never ? never : unknown; stream: PDFRawStream }[] =
    [];
  for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const type = obj.dict.get(PDFName.of("Type"));
    if (type instanceof PDFName) {
      const t = type.asString();
      if (t === "/ObjStm" || t === "/XRef" || t === "/Metadata") continue;
    }
    const filters = filterNames(obj.dict.get(PDFName.of("Filter")));
    if (filters.length > 0) continue;
    const raw = obj.getContents();
    if (raw.length < 128) continue;
    const compressed = deflateSync(raw, { level: 9 });
    if (compressed.byteLength >= raw.length * 0.95) continue;
    const dict = obj.dict.clone(pdf.context);
    dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
    dict.set(PDFName.Length, PDFNumber.of(compressed.byteLength));
    dict.delete(PDFName.of("DecodeParms"));
    dict.delete(PDFName.of("DP"));
    updates.push({ ref, stream: PDFRawStream.of(dict, compressed) });
  }
  for (const { ref, stream } of updates) {
    pdf.context.assign(ref as never, stream);
  }
  return updates.length;
}

function applyJpegDict(
  pdf: PDFDocument,
  dict: PDFDict,
  next: Buffer,
  width: number,
  height: number
): PDFRawStream {
  const cloned = dict.clone(pdf.context);
  cloned.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
  cloned.set(PDFName.Length, PDFNumber.of(next.byteLength));
  cloned.set(PDFName.of("Width"), PDFNumber.of(width));
  cloned.set(PDFName.of("Height"), PDFNumber.of(height));
  cloned.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  cloned.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
  cloned.delete(PDFName.of("DecodeParms"));
  cloned.delete(PDFName.of("DP"));
  cloned.delete(PDFName.of("SMask"));
  cloned.delete(PDFName.of("Mask"));
  cloned.delete(PDFName.of("Decode"));
  return PDFRawStream.of(cloned, next);
}

/**
 * Shrink embedded images. Optional-content groups (layers) stay intact because
 * we only replace image streams — we do not flatten or rewrite page operators.
 */
export async function compressPdfKeepLayers(
  input: Buffer,
  options?: CompressPdfOptions
): Promise<{ buffer: Buffer; imagesRecompressed: number }> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const jpegQuality = options?.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  const recompressFlate = options?.recompressFlate ?? false;
  const deflateUnfiltered = options?.deflateUnfiltered ?? false;

  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  let imagesRecompressed = 0;
  const sharp = await loadSharp();

  if (sharp) {
    for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      if (!isImageXObject(obj.dict)) continue;
      if (obj.dict.get(PDFName.of("ImageMask"))) continue;

      const filters = filterNames(obj.dict.get(PDFName.of("Filter")));
      const isJpeg = filters.includes("DCTDecode");
      const isFlate =
        filters.length === 0 ||
        (filters.length === 1 && filters[0] === "FlateDecode");
      if (!isJpeg && !(recompressFlate && isFlate)) continue;

      let decoded: Uint8Array;
      try {
        decoded = decodePDFRawStream(obj).decode();
      } catch {
        continue;
      }
      if (decoded.byteLength < 8) continue;

      try {
        let pipeline: SharpInstance;
        const origW = dictNumber(obj.dict, "Width");
        const origH = dictNumber(obj.dict, "Height");
        if (isJpeg) {
          pipeline = sharp(Buffer.from(decoded)).rotate();
        } else {
          const bpc = dictNumber(obj.dict, "BitsPerComponent") ?? 8;
          const channels = rawChannels(obj.dict);
          if (!origW || !origH || bpc !== 8 || !channels) continue;
          if (decoded.byteLength < origW * origH * channels) continue;
          pipeline = sharp(Buffer.from(decoded), {
            raw: { width: origW, height: origH, channels },
          });
        }

        const { data: next, info } = await pipeline
          .resize({
            width: maxEdge,
            height: maxEdge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: jpegQuality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });

        const resized =
          (origW != null && info.width < origW) ||
          (origH != null && info.height < origH);
        if (!resized && next.byteLength >= decoded.byteLength * 0.95) continue;

        pdf.context.assign(
          ref,
          applyJpegDict(pdf, obj.dict, next, info.width, info.height)
        );
        imagesRecompressed += 1;
      } catch {
        /* skip this image */
      }
    }
  }

  if (deflateUnfiltered) {
    deflateUnfilteredStreams(pdf);
  }

  const pagesBefore = pdf.getPageCount();
  const saved = await pdf.save({ useObjectStreams: true });
  const out = Buffer.from(saved);
  const pagesAfter = (
    await PDFDocument.load(out, { ignoreEncryption: true })
  ).getPageCount();
  if (pagesAfter !== pagesBefore) {
    console.warn(
      `[pdf-preview] compress changed page count ${pagesBefore} → ${pagesAfter}`
    );
    return { buffer: input, imagesRecompressed: 0 };
  }
  return { buffer: out, imagesRecompressed };
}

/** In-memory shrink of Final-for-Prod PDFs before they are appended to a job ticket. */
export async function compressPdfForJobTicket(
  input: Buffer
): Promise<Buffer> {
  try {
    const { buffer } = await compressPdfKeepLayers(input, {
      maxEdge: JOB_TICKET_MAX_EDGE,
      jpegQuality: JOB_TICKET_JPEG_QUALITY,
      recompressFlate: true,
      deflateUnfiltered: true,
    });
    console.warn(
      `[job-ticket] compressed Final PDF ${(input.byteLength / 1024 / 1024).toFixed(1)}MB → ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB`
    );
    return buffer.byteLength < input.byteLength ? buffer : input;
  } catch (err) {
    console.warn(
      "[job-ticket] final PDF compress failed; appending original",
      err instanceof Error ? err.message : err
    );
    return input;
  }
}
