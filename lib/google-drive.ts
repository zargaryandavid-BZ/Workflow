import "server-only";

import { google } from "googleapis";
import type { GdriveLinkTarget, GdriveSettings } from "@/lib/types";
import { isGdriveConfigured } from "@/lib/gdrive-settings";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFolderRefs = {
  /** Designer folder: e.g. 26-0098_Acme Corp */
  jobId: string;
  jobUrl: string;
  /** Final production folder: e.g. FinalProd_1 */
  finalId: string;
  finalUrl: string;
  linkUrl: string;
};

function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

/** Drive folder names cannot contain / — keep the rest printable. */
export function sanitizeDriveFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || "Untitled";
}

/**
 * Short code for folder names: ORD-2026-0098 → 26-0098.
 * Leaves already-short values (e.g. 26-0098, 0098) as-is.
 */
export function shortDriveOrderCode(orderKey: string): string {
  const trimmed = orderKey.trim();
  if (!trimmed) return "order";
  const withYear = /^ord-(\d{4})-(.+)$/i.exec(trimmed);
  if (withYear) {
    const yy = withYear[1].slice(2);
    const rest = withYear[2].trim();
    return rest ? `${yy}-${rest}` : `${yy}`;
  }
  return trimmed.replace(/^ORD-/i, "");
}

function driveClient(settings: GdriveSettings) {
  const auth = new google.auth.JWT({
    email: settings.client_email!.trim(),
    key: normalizePrivateKey(settings.private_key!),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findChildFolder(
  drive: ReturnType<typeof driveClient>,
  parentId: string,
  name: string,
  sharedDriveId: string | null
): Promise<{ id: string; webViewLink: string } | null> {
  const q = [
    `name='${escapeDriveQuery(name)}'`,
    `'${parentId}' in parents`,
    `mimeType='${FOLDER_MIME}'`,
    "trashed=false",
  ].join(" and ");

  const res = await drive.files.list({
    q,
    fields: "files(id, name, webViewLink)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(sharedDriveId
      ? { corpora: "drive" as const, driveId: sharedDriveId }
      : { corpora: "allDrives" as const }),
  });

  const file = res.data.files?.[0];
  if (!file?.id) return null;
  return {
    id: file.id,
    webViewLink:
      file.webViewLink ?? `https://drive.google.com/drive/folders/${file.id}`,
  };
}

async function createFolder(
  drive: ReturnType<typeof driveClient>,
  parentId: string,
  name: string
): Promise<{ id: string; webViewLink: string }> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });
  const id = res.data.id;
  if (!id) throw new Error("Drive create folder returned no id");
  return {
    id,
    webViewLink:
      res.data.webViewLink ?? `https://drive.google.com/drive/folders/${id}`,
  };
}

async function findOrCreateFolder(
  drive: ReturnType<typeof driveClient>,
  parentId: string,
  name: string,
  sharedDriveId: string | null
): Promise<{ id: string; webViewLink: string }> {
  const existing = await findChildFolder(drive, parentId, name, sharedDriveId);
  if (existing) return existing;
  return createFolder(drive, parentId, name);
}

function pickLink(
  target: GdriveLinkTarget,
  refs: Omit<DriveFolderRefs, "linkUrl">
): string {
  // Designer folder (XXXX) for "customer" / "order"; Final production for "final".
  if (target === "final") return refs.finalUrl;
  return refs.jobUrl;
}

/**
 * Shared Drive IDs from Drive URLs typically start with `0A`.
 * Folder IDs usually start with `1` — never pass those as `driveId`.
 */
function resolveSharedDriveId(settings: GdriveSettings): string | null {
  const explicit = settings.shared_drive_id?.trim() || null;
  if (explicit) return explicit;
  const root = settings.root_folder_id?.trim() || "";
  // Root is the Shared Drive itself (user pasted the drive URL id).
  if (/^0A[A-Za-z0-9_-]+$/.test(root)) return root;
  return null;
}

/**
 * Shared Drive root
 *   └── {code}_{Customer Name}/                 ← Designer folder (XXXX)
 *         └── {code}_{Customer Name}_Y/         ← item folder (XXXX_Y)
 *               └── {FinalProd}_Y/              ← Final production
 *
 * XXXX = ordernumber_customername (e.g. 26-0098_Acme Corp).
 * Y is the 1-based item index (defaults to 1).
 *
 * @param itemIndex 1-based part number; defaults to 1 when omitted.
 */
export async function ensureOrderDriveFolders(
  settings: GdriveSettings,
  customerName: string,
  orderKey: string,
  itemIndex?: number | null
): Promise<DriveFolderRefs> {
  if (!isGdriveConfigured(settings)) {
    throw new Error("Google Drive is not configured");
  }

  const drive = driveClient(settings);
  const rootId = settings.root_folder_id!.trim();
  const sharedDriveId = resolveSharedDriveId(settings);
  const code = sanitizeDriveFolderName(shortDriveOrderCode(orderKey));
  const customer = sanitizeDriveFolderName(customerName);
  const finalLabel = sanitizeDriveFolderName(
    settings.final_folder_name || "Final for Prod"
  );

  const y =
    typeof itemIndex === "number" && itemIndex >= 1
      ? Math.floor(itemIndex)
      : 1;
  const suffix = `_${y}`;

  // XXXX — Designer folder (shared across items on the same order)
  const designerFolderName = sanitizeDriveFolderName(`${code}_${customer}`);
  // XXXX_Y — per-item working folder
  const itemFolderName = sanitizeDriveFolderName(
    `${code}_${customer}${suffix}`
  );
  // FinalProd_Y — Final production
  const finalFolderName = sanitizeDriveFolderName(`${finalLabel}${suffix}`);

  const designerFolder = await findOrCreateFolder(
    drive,
    rootId,
    designerFolderName,
    sharedDriveId
  );
  const itemFolder = await findOrCreateFolder(
    drive,
    designerFolder.id,
    itemFolderName,
    sharedDriveId
  );
  const finalFolder = await findOrCreateFolder(
    drive,
    itemFolder.id,
    finalFolderName,
    sharedDriveId
  );

  const refs = {
    jobId: designerFolder.id,
    jobUrl: designerFolder.webViewLink,
    finalId: finalFolder.id,
    finalUrl: finalFolder.webViewLink,
  };

  return {
    ...refs,
    linkUrl: pickLink(settings.link_target, refs),
  };
}

/** Extract a Drive file/folder id from a Google Drive URL or raw id. */
export function parseDriveIdFromUrl(urlOrId: string): string | null {
  const raw = urlOrId.trim();
  if (!raw) return null;
  // Already a bare id (folder/file ids are typically 25–60+ chars).
  if (/^[A-Za-z0-9_-]{10,}$/.test(raw) && !raw.includes("/") && !raw.includes("?")) {
    return raw;
  }
  try {
    const u = new URL(raw);
    const folders = /\/folders\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (folders?.[1]) return folders[1];
    const file = /\/file\/d\/([A-Za-z0-9_-]+)/.exec(u.pathname);
    if (file?.[1]) return file[1];
    const id = u.searchParams.get("id");
    if (id && /^[A-Za-z0-9_-]+$/.test(id)) return id;
  } catch {
    // not a URL
  }
  return null;
}

/**
 * True when the Drive folder has at least one non-folder, non-trashed item
 * directly inside it (does not recurse into subfolders).
 */
export async function folderHasFiles(
  settings: GdriveSettings,
  folderId: string
): Promise<{ hasFiles: boolean; fileCount: number }> {
  if (!isGdriveConfigured(settings)) {
    return { hasFiles: false, fileCount: 0 };
  }

  const drive = driveClient(settings);
  const sharedDriveId = resolveSharedDriveId(settings);
  const q = [
    `'${folderId}' in parents`,
    `mimeType!='${FOLDER_MIME}'`,
    "trashed=false",
  ].join(" and ");

  const res = await drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(sharedDriveId
      ? { corpora: "drive" as const, driveId: sharedDriveId }
      : { corpora: "allDrives" as const }),
  });

  const count = res.data.files?.length ?? 0;
  return { hasFiles: count > 0, fileCount: count };
}

/** Lightweight check used by Settings → Test connection. */
export async function testGdriveConnection(
  settings: GdriveSettings
): Promise<{ ok: true; folderName: string } | { ok: false; error: string }> {
  if (!isGdriveConfigured(settings)) {
    return {
      ok: false,
      error: "Fill in client email, private key, and root folder ID first.",
    };
  }
  try {
    const drive = driveClient(settings);
    const res = await drive.files.get({
      fileId: settings.root_folder_id!.trim(),
      fields: "id, name, mimeType",
      supportsAllDrives: true,
    });
    return { ok: true, folderName: res.data.name ?? settings.root_folder_id! };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
