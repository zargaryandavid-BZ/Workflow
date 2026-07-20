import "server-only";

import { google } from "googleapis";
import type { GdriveLinkTarget, GdriveSettings } from "@/lib/types";
import { isGdriveConfigured } from "@/lib/gdrive-settings";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFolderRefs = {
  /** Job folder: e.g. 26-0098_Acme Corp */
  jobId: string;
  jobUrl: string;
  /** Subfolder: e.g. 26-0098_Final for Prod */
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
  // "customer" / "order" both point at the job folder in the 2-level layout.
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
 *   └── {code}_{Customer Name}/              (single-item)
 *         └── {code}_{Final for Prod}/
 *   └── {code}_{Customer Name}_1/            (multi-item part 1)
 *         └── {code}_{Final for Prod}_1/
 *   └── {code}_{Customer Name}_2/            (multi-item part 2)
 *         └── {code}_{Final for Prod}_2/
 *
 * @param itemIndex 1-based part number for multi-item orders; omit for single-item.
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

  const suffix =
    typeof itemIndex === "number" && itemIndex >= 1 ? `_${itemIndex}` : "";

  const jobFolderName = sanitizeDriveFolderName(
    `${code}_${customer}${suffix}`
  );
  const finalFolderName = sanitizeDriveFolderName(
    `${code}_${finalLabel}${suffix}`
  );

  const jobFolder = await findOrCreateFolder(
    drive,
    rootId,
    jobFolderName,
    sharedDriveId
  );
  const finalFolder = await findOrCreateFolder(
    drive,
    jobFolder.id,
    finalFolderName,
    sharedDriveId
  );

  const refs = {
    jobId: jobFolder.id,
    jobUrl: jobFolder.webViewLink,
    finalId: finalFolder.id,
    finalUrl: finalFolder.webViewLink,
  };

  return {
    ...refs,
    linkUrl: pickLink(settings.link_target, refs),
  };
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
