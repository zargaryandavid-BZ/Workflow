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

/** Find or create a named child folder under a parent (idempotent). */
export async function ensureChildFolder(
  { drive, sharedDriveId }: ProofsDrive,
  parentId: string,
  rawName: string
): Promise<{ id: string; name: string; webViewLink: string; created: boolean }> {
  const name = sanitizeDriveFolderName(rawName) || "Untitled";
  const q = [
    `name='${escapeQuery(name)}'`,
    `'${escapeQuery(parentId)}' in parents`,
    `mimeType='${FOLDER_MIME}'`,
    "trashed=false",
  ].join(" and ");
  const found = await drive.files.list({
    q,
    fields: "files(id,name,webViewLink)",
    pageSize: 1,
    ...driveListParams(sharedDriveId),
  });
  const hit = found.data.files?.[0];
  if (hit?.id) return { id: hit.id, name, webViewLink: hit.webViewLink ?? "", created: false };

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });
  return { id: created.data.id!, name, webViewLink: created.data.webViewLink ?? "", created: true };
}

/** Find or create the order's "Proofs" subfolder under its designer folder. */
export async function findOrCreateProofsFolder(
  client: ProofsDrive,
  designerFolderId: string
): Promise<{ id: string; webViewLink: string }> {
  const f = await ensureChildFolder(client, designerFolderId, PROOFS_FOLDER_NAME);
  return { id: f.id, webViewLink: f.webViewLink };
}

/**
 * Ensure one working subfolder per version name under the designer folder, plus
 * the shared "Proofs" folder. De-dupes repeated version names. Idempotent.
 */
export async function ensureArtworkFolderTree(
  client: ProofsDrive,
  designerFolderId: string,
  versionNames: string[]
): Promise<{
  proofs: { id: string; webViewLink: string };
  versions: { name: string; id: string; webViewLink: string; created: boolean }[];
}> {
  const proofsFull = await ensureChildFolder(client, designerFolderId, PROOFS_FOLDER_NAME);
  const seen = new Set<string>();
  const versions: { name: string; id: string; webViewLink: string; created: boolean }[] = [];
  for (const raw of versionNames) {
    const name = (raw || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const f = await ensureChildFolder(client, designerFolderId, name);
    versions.push({ name: f.name, id: f.id, webViewLink: f.webViewLink, created: f.created });
  }
  return { proofs: { id: proofsFull.id, webViewLink: proofsFull.webViewLink }, versions };
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
