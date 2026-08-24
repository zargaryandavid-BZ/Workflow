import "server-only";

import { google } from "googleapis";
import type { GdriveSettings } from "@/lib/types";
import { isGdriveConfigured } from "@/lib/gdrive-settings";
import { sanitizeDriveFolderName } from "@/lib/google-drive";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const PROOFS_FOLDER_NAME = "Proofs";

function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
}

export type ProofsDrive = {
  drive: ReturnType<typeof google.drive>;
  auth: InstanceType<typeof google.auth.JWT>;
  sharedDriveId: string | null;
};

export function proofsDriveClient(settings: GdriveSettings): ProofsDrive {
  if (!isGdriveConfigured(settings)) {
    throw new Error("Google Drive is not configured");
  }
  const auth = new google.auth.JWT({
    email: settings.client_email!.trim(),
    key: normalizePrivateKey(settings.private_key!),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  const sharedDriveId = settings.shared_drive_id?.trim() || null;
  return { drive, auth, sharedDriveId };
}

function driveListParams(sharedDriveId: string | null) {
  return sharedDriveId
    ? {
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "drive" as const,
        driveId: sharedDriveId,
      }
    : { supportsAllDrives: true, includeItemsFromAllDrives: true };
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Find or create the order's "Proofs" subfolder under its designer folder. */
export async function findOrCreateProofsFolder(
  { drive, sharedDriveId }: ProofsDrive,
  designerFolderId: string
): Promise<{ id: string; webViewLink: string }> {
  const name = sanitizeDriveFolderName(PROOFS_FOLDER_NAME);
  const q = [
    `name='${escapeQuery(name)}'`,
    `'${escapeQuery(designerFolderId)}' in parents`,
    `mimeType='${FOLDER_MIME}'`,
    "trashed=false",
  ].join(" and ");
  const found = await drive.files.list({
    q,
    fields: "files(id,webViewLink)",
    pageSize: 1,
    ...driveListParams(sharedDriveId),
  });
  const hit = found.data.files?.[0];
  if (hit?.id) return { id: hit.id, webViewLink: hit.webViewLink ?? "" };

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [designerFolderId] },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });
  return {
    id: created.data.id!,
    webViewLink: created.data.webViewLink ?? "",
  };
}

export type ProofFile = {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink: string | null;
};

/** List every non-folder file directly inside the Proofs folder. */
export async function listProofFiles(
  { drive, sharedDriveId }: ProofsDrive,
  proofsFolderId: string
): Promise<ProofFile[]> {
  const out: ProofFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: [
        `'${escapeQuery(proofsFolderId)}' in parents`,
        `mimeType!='${FOLDER_MIME}'`,
        "trashed=false",
      ].join(" and "),
      fields: "nextPageToken, files(id,name,mimeType,thumbnailLink)",
      pageSize: 200,
      pageToken,
      ...driveListParams(sharedDriveId),
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) {
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType ?? "",
          thumbnailLink: f.thumbnailLink ?? null,
        });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/**
 * Produce image bytes for a proof file suitable for a SKU gallery slot.
 * - Real images → download the bytes directly.
 * - PDF/AI/anything else → use Drive's own generated thumbnail (a JPEG), bumped
 *   to a larger size. This is why no PDF rasterizer is needed on the server.
 */
export async function fetchPreviewBytes(
  { drive, auth }: ProofsDrive,
  file: ProofFile
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (file.mimeType.startsWith("image/")) {
    const res = await drive.files.get(
      { fileId: file.id, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      contentType: file.mimeType,
    };
  }

  // Non-image → Drive thumbnail (JPEG). Refetch the link to be safe/fresh.
  let link = file.thumbnailLink;
  if (!link) {
    const meta = await drive.files.get({
      fileId: file.id,
      fields: "thumbnailLink",
      supportsAllDrives: true,
    });
    link = meta.data.thumbnailLink ?? null;
  }
  if (!link) return null;
  const hiRes = link.replace(/=s\d+$/, "=s1600");

  const tokenRes = await auth.getAccessToken();
  const token = typeof tokenRes === "string" ? tokenRes : tokenRes?.token;
  const resp = await fetch(hiRes, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) return null;
  const buf = Buffer.from(await resp.arrayBuffer());
  return { buffer: buf, contentType: resp.headers.get("content-type") || "image/jpeg" };
}
