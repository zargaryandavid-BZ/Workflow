import "server-only";

import type { ProofsDrive } from "@/lib/gdrive-proofs";
import {
  downloadDriveFileBytes,
  getDriveFileMeta,
  getDriveFolderMeta,
} from "@/lib/gdrive-proofs";
import { compressPdfKeepLayers } from "@/lib/pdf-preview-compress";

/** In-request compress cap. 700 MB files cannot be processed on Vercel. */
export const WEB_PREVIEW_SOURCE_MAX_BYTES = 90 * 1024 * 1024;
const SKIP_COMPRESS_UNDER_BYTES = 8 * 1024 * 1024;
const PREVIEW_PROP = "workflowPreviewOf";

function previewQuery(originalId: string): string {
  const id = originalId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return [
    `appProperties has { key='${PREVIEW_PROP}' and value='${id}' }`,
    "trashed=false",
  ].join(" and ");
}

export async function findWebPreviewFileId(
  { drive }: ProofsDrive,
  originalId: string
): Promise<string | null> {
  const res = await drive.files.list({
    q: previewQuery(originalId),
    fields: "files(id,modifiedTime)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

async function uploadWebPreview(
  { drive }: ProofsDrive,
  original: { id: string; name: string; parents: string[] },
  pdf: Buffer
): Promise<string> {
  const base = original.name.replace(/\.pdf$/i, "").replace(/\s*\(web preview\)$/i, "");
  const name = `${base} (web preview).pdf`;
  const existing = await findWebPreviewFileId({ drive } as ProofsDrive, original.id);
  if (existing) {
    await drive.files.update({
      fileId: existing,
      media: { mimeType: "application/pdf", body: pdf },
      supportsAllDrives: true,
    });
    return existing;
  }
  const parent = original.parents[0];
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/pdf",
      appProperties: { [PREVIEW_PROP]: original.id },
      ...(parent ? { parents: [parent] } : {}),
    },
    media: { mimeType: "application/pdf", body: pdf },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error("Failed to save web preview to Drive");
  return created.data.id;
}

/**
 * Bytes to stream on /respond. Uses a cached Drive preview when present.
 * Compresses JPEGs in-place (keeps OCG layers) for files that fit in memory.
 */
export async function resolveWebPreviewPdf(
  client: ProofsDrive,
  fileId: string,
  opts?: { force?: boolean; sourceMaxBytes?: number }
): Promise<{
  buffer: Buffer;
  mimeType: string;
  name: string;
  size: number;
  preview: boolean;
} | null> {
  const sourceMax = opts?.sourceMaxBytes ?? WEB_PREVIEW_SOURCE_MAX_BYTES;
  const meta = await getDriveFolderMeta(client, fileId);
  if (!meta) return null;

  const fileInfo = await getDriveFileMeta(client, fileId);
  if (!fileInfo) return null;

  const cachedId = await findWebPreviewFileId(client, fileId);
  if (cachedId && !opts?.force) {
    const cached = await downloadDriveFileBytes(client, cachedId);
    if (cached) {
      return {
        buffer: cached.buffer,
        mimeType: "application/pdf",
        name: cached.name,
        size: cached.buffer.byteLength,
        preview: true,
      };
    }
  }

  if (fileInfo.size > sourceMax) {
    return null;
  }

  const original = await downloadDriveFileBytes(client, fileId);
  if (!original) return null;

  if (original.buffer.byteLength <= SKIP_COMPRESS_UNDER_BYTES && !opts?.force) {
    return {
      buffer: original.buffer,
      mimeType: "application/pdf",
      name: original.name,
      size: original.buffer.byteLength,
      preview: false,
    };
  }

  try {
    const { buffer, imagesRecompressed } = await compressPdfKeepLayers(
      original.buffer
    );
    if (imagesRecompressed === 0 && buffer.byteLength >= original.buffer.byteLength * 0.9) {
      return {
        buffer: original.buffer,
        mimeType: "application/pdf",
        name: original.name,
        size: original.buffer.byteLength,
        preview: false,
      };
    }
    await uploadWebPreview(client, meta, buffer);
    return {
      buffer,
      mimeType: "application/pdf",
      name: `${meta.name.replace(/\.pdf$/i, "")} (web preview).pdf`,
      size: buffer.byteLength,
      preview: true,
    };
  } catch (err) {
    console.error("[pdf-web-preview]", err instanceof Error ? err.message : err);
    return {
      buffer: original.buffer,
      mimeType: "application/pdf",
      name: original.name,
      size: original.buffer.byteLength,
      preview: false,
    };
  }
}
