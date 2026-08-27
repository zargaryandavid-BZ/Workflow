import "server-only";

import { google } from "googleapis";
import type { GdriveLinkTarget, GdriveSettings } from "@/lib/types";
import { isGdriveConfigured } from "@/lib/gdrive-settings";
import {
  buildDriveFolderPlan,
  sanitizeDriveFolderName,
  sanitizeDriveItemTitle,
  shortDriveOrderCode,
} from "@/lib/drive-folder-names";

export {
  sanitizeDriveFolderName,
  sanitizeDriveItemTitle,
  shortDriveOrderCode,
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFolderRefs = {
  /** Designer folder: e.g. 0269_Acme Corp */
  jobId: string;
  jobUrl: string;
  /** Final production folder: e.g. 0269_Acme Corp_1_FinalProd */
  finalId: string;
  finalUrl: string;
  linkUrl: string;
};

function normalizePrivateKey(key: string): string {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
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

async function renameFolder(
  drive: ReturnType<typeof driveClient>,
  id: string,
  name: string,
  webViewLink: string
): Promise<{ id: string; webViewLink: string }> {
  const res = await drive.files.update({
    fileId: id,
    requestBody: { name },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });
  return {
    id: res.data.id ?? id,
    webViewLink:
      res.data.webViewLink ??
      webViewLink ??
      `https://drive.google.com/drive/folders/${id}`,
  };
}

async function findFirstChild(
  drive: ReturnType<typeof driveClient>,
  parentId: string,
  names: string[],
  sharedDriveId: string | null
): Promise<{ id: string; webViewLink: string; matchedName: string } | null> {
  for (const name of names) {
    const found = await findChildFolder(drive, parentId, name, sharedDriveId);
    if (found) return { ...found, matchedName: name };
  }
  return null;
}

async function maybeRenameFolder(
  drive: ReturnType<typeof driveClient>,
  folder: { id: string; webViewLink: string },
  desiredName: string,
  currentName: string
): Promise<{ id: string; webViewLink: string }> {
  if (currentName === desiredName) return folder;
  try {
    return await renameFolder(drive, folder.id, desiredName, folder.webViewLink);
  } catch (err) {
    console.warn(
      `[gdrive] could not rename "${currentName}" → "${desiredName}":`,
      err instanceof Error ? err.message : err
    );
    return folder;
  }
}

async function moveFolderToParent(
  drive: ReturnType<typeof driveClient>,
  fileId: string,
  fromParentId: string,
  toParentId: string
): Promise<void> {
  if (fromParentId === toParentId) return;
  await drive.files.update({
    fileId,
    addParents: toParentId,
    removeParents: fromParentId,
    supportsAllDrives: true,
    fields: "id",
  });
}

async function findOrCreatePreferredFolder(
  drive: ReturnType<typeof driveClient>,
  parentId: string,
  name: string,
  aliases: string[],
  sharedDriveId: string | null
): Promise<{ id: string; webViewLink: string }> {
  const existing = await findFirstChild(
    drive,
    parentId,
    [name, ...aliases],
    sharedDriveId
  );
  if (existing) {
    return maybeRenameFolder(drive, existing, name, existing.matchedName);
  }
  return createFolder(drive, parentId, name);
}

async function ensureFolderWithAliases(
  drive: ReturnType<typeof driveClient>,
  destParentId: string,
  name: string,
  aliases: string[],
  extraParentIds: string[],
  sharedDriveId: string | null
): Promise<{ id: string; webViewLink: string }> {
  const names = [name, ...aliases];
  const here = await findFirstChild(drive, destParentId, names, sharedDriveId);
  if (here) return maybeRenameFolder(drive, here, name, here.matchedName);

  for (const parentId of extraParentIds) {
    if (!parentId || parentId === destParentId) continue;
    const found = await findFirstChild(drive, parentId, names, sharedDriveId);
    if (!found) continue;
    try {
      await moveFolderToParent(drive, found.id, parentId, destParentId);
    } catch (err) {
      console.warn(
        `[gdrive] could not move "${found.matchedName}" into the order folder:`,
        err instanceof Error ? err.message : err
      );
      return maybeRenameFolder(drive, found, name, found.matchedName);
    }
    return maybeRenameFolder(drive, found, name, found.matchedName);
  }

  return createFolder(drive, destParentId, name);
}

function pickLink(
  target: GdriveLinkTarget,
  refs: Omit<DriveFolderRefs, "linkUrl">
): string {
  // Designer folder (XXXX_Y) for "customer" / "order"; Final production for "final".
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
 *   └── {code}_{Customer}_Y/                    ← main order folder
 *         └── {code}_{Customer}_Y_FinalProd/    ← Final production
 *
 * Example: `0269_Dessertz_1` / `0269_Dessertz_1_FinalProd`.
 * Year prefixes (`26-0269_…`) and old `Final for Prod_Y` names are reused and
 * renamed. A shared `{code}_{Customer}` parent is still used when it already
 * exists (older layout).
 */
export async function ensureOrderDriveFolders(
  settings: GdriveSettings,
  customerName: string,
  orderKey: string,
  itemIndex?: number | null,
  itemTitle?: string | null,
  appendIndex?: boolean
): Promise<DriveFolderRefs> {
  if (!isGdriveConfigured(settings)) {
    throw new Error("Google Drive is not configured");
  }

  const drive = driveClient(settings);
  const rootId = settings.root_folder_id!.trim();
  const sharedDriveId = resolveSharedDriveId(settings);
  const plan = buildDriveFolderPlan({
    orderKey,
    customerName,
    itemIndex,
    itemTitle,
    appendIndex,
    finalFolderName: settings.final_folder_name,
  });

  const designerAtRoot = await findFirstChild(
    drive,
    rootId,
    [plan.designerName, ...plan.designerAliases],
    sharedDriveId
  );

  let designerFolder: { id: string; webViewLink: string };
  let itemFolder: { id: string; webViewLink: string };

  if (designerAtRoot) {
    designerFolder = await maybeRenameFolder(
      drive,
      designerAtRoot,
      plan.designerName,
      designerAtRoot.matchedName
    );
    itemFolder = await findOrCreatePreferredFolder(
      drive,
      designerFolder.id,
      plan.itemName,
      plan.itemAliases,
      sharedDriveId
    );
  } else {
    const itemAtRoot = await findFirstChild(
      drive,
      rootId,
      [plan.itemName, ...plan.itemAliases],
      sharedDriveId
    );
    if (itemAtRoot) {
      itemFolder = await maybeRenameFolder(
        drive,
        itemAtRoot,
        plan.itemName,
        itemAtRoot.matchedName
      );
      designerFolder = itemFolder;
    } else {
      itemFolder = await createFolder(drive, rootId, plan.itemName);
      designerFolder = itemFolder;
    }
  }

  const extraFinalParents = [designerFolder.id, rootId].filter(
    (id, i, all) => id !== itemFolder.id && all.indexOf(id) === i
  );
  const finalFolder = await ensureFolderWithAliases(
    drive,
    itemFolder.id,
    plan.finalName,
    plan.finalAliases,
    extraFinalParents,
    sharedDriveId
  );

  const refs = {
    jobId: itemFolder.id,
    jobUrl: itemFolder.webViewLink,
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
 * directly inside it, or inside an immediate child folder (one level deep).
 * That way a parent job folder still counts as "has files" when Final production
 * (or another subfolder) contains artwork.
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
  const listOpts = {
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(sharedDriveId
      ? { corpora: "drive" as const, driveId: sharedDriveId }
      : { corpora: "allDrives" as const }),
  };

  // One list for files + folders (cheaper than two sequential queries).
  const listing = await drive.files.list({
    q: [`'${folderId}' in parents`, "trashed=false"].join(" and "),
    fields: "files(id,mimeType)",
    pageSize: 50,
    ...listOpts,
  });

  const entries = listing.data.files ?? [];
  const directFiles = entries.filter((f) => f.mimeType !== FOLDER_MIME);
  if (directFiles.length > 0) {
    return { hasFiles: true, fileCount: directFiles.length };
  }

  const childFolders = entries.filter(
    (f) => f.mimeType === FOLDER_MIME && Boolean(f.id)
  );
  if (childFolders.length === 0) {
    return { hasFiles: false, fileCount: 0 };
  }

  // Probe child folders in parallel; stop as soon as any has a file.
  const results = await Promise.all(
    childFolders.map(async (child) => {
      const nestedRes = await drive.files.list({
        q: [
          `'${child.id}' in parents`,
          `mimeType!='${FOLDER_MIME}'`,
          "trashed=false",
        ].join(" and "),
        fields: "files(id)",
        pageSize: 1,
        ...listOpts,
      });
      return nestedRes.data.files?.length ?? 0;
    })
  );

  const nestedCount = results.reduce((sum, n) => sum + n, 0);
  return { hasFiles: nestedCount > 0, fileCount: nestedCount };
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
