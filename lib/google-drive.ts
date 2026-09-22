import "server-only";

import { google } from "googleapis";
import type { GdriveLinkTarget, GdriveSettings } from "@/lib/types";
import { isGdriveConfigured } from "@/lib/gdrive-settings";
import {
  buildDriveFolderPlan,
  isFinalProdFolderName,
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

  const listParams = {
    fields: "files(id, name, webViewLink)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(sharedDriveId
      ? { corpora: "drive" as const, driveId: sharedDriveId }
      : { corpora: "allDrives" as const }),
  };

  const res = await drive.files.list({ q, ...listParams });

  const file = res.data.files?.[0];
  if (file?.id) {
    return {
      id: file.id,
      webViewLink:
        file.webViewLink ?? `https://drive.google.com/drive/folders/${file.id}`,
    };
  }

  return null;
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
  if (names.length === 0) return null;

  // Batch all candidate names into a single Drive query with OR conditions
  // instead of one files.list call per name (the old sequential loop).
  // Drive supports: (name = 'A' or name = 'B') and '...' in parents ...
  const listParams = {
    fields: "files(id, name, webViewLink)",
    pageSize: names.length + 2,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(sharedDriveId
      ? { corpora: "drive" as const, driveId: sharedDriveId }
      : { corpora: "allDrives" as const }),
  };

  const nameOrClause =
    names.length === 1
      ? `name='${escapeDriveQuery(names[0])}'`
      : `(${names.map((n) => `name='${escapeDriveQuery(n)}'`).join(" or ")})`;

  // First: look for live (non-trashed) matches.
  const liveRes = await drive.files.list({
    q: [
      nameOrClause,
      `'${parentId}' in parents`,
      `mimeType='${FOLDER_MIME}'`,
      "trashed=false",
    ].join(" and "),
    ...listParams,
  });
  const liveFiles = liveRes.data.files ?? [];
  // Prefer names in priority order (canonical name first, aliases after).
  for (const name of names) {
    const match = liveFiles.find((f) => f.name === name);
    if (match?.id) {
      return {
        id: match.id,
        webViewLink: match.webViewLink ?? `https://drive.google.com/drive/folders/${match.id}`,
        matchedName: name,
      };
    }
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
 * Shared Drive root (job folders)
 *   └── {code}_{Customer}_Y/
 * Final production parent (Settings → Final production folder), else inside the job folder
 *   └── {code}_{Customer}_Y_FinalProd/
 *
 * Example: `3009_Bowboyz Ecotics_1` / `3009_Bowboyz Ecotics_1_FinalProd`.
 * Year prefixes (`26-3009_…`) are reused and renamed.
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

  const finalParentId =
    settings.final_root_folder_id?.trim() || itemFolder.id;
  const extraFinalParents = [
    designerFolder.id,
    itemFolder.id,
    rootId,
  ].filter(
    (id, i, all) => Boolean(id) && id !== finalParentId && all.indexOf(id) === i
  );
  const finalFolder = await ensureFolderWithAliases(
    drive,
    finalParentId,
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
 * False when the folder is missing or in trash. Never undeletes.
 */
export async function isLiveDriveFolder(
  settings: GdriveSettings,
  urlOrId: string
): Promise<boolean> {
  const id = parseDriveIdFromUrl(urlOrId);
  if (!id || !isGdriveConfigured(settings)) return false;
  try {
    const drive = driveClient(settings);
    const res = await drive.files.get({
      fileId: id,
      fields: "id, trashed",
      supportsAllDrives: true,
    });
    if (!res.data.id) return false;
    return res.data.trashed !== true;
  } catch {
    return false;
  }
}

/**
 * True when the Drive folder has at least one non-folder, non-trashed item
 * directly inside it, or inside an immediate child folder (one level deep).
 * That way a parent job folder still counts as "has files" when Final production
 * (or another subfolder) contains artwork.
 */
function isDrivePdfFile(file: {
  mimeType?: string | null;
  name?: string | null;
  shortcutDetails?: { targetMimeType?: string | null } | null;
}): boolean {
  const mime = (file.mimeType || "").toLowerCase();
  const target = (file.shortcutDetails?.targetMimeType || "").toLowerCase();
  if (mime.includes("pdf") || target.includes("pdf")) return true;
  return (file.name || "").toLowerCase().endsWith(".pdf");
}

export async function folderHasFiles(
  settings: GdriveSettings,
  folderId: string,
  opts?: {
    excludeChildIds?: string[];
    skipFinalProdChildren?: boolean;
    /** Only files sitting in this folder — do not walk child folders. */
    directOnly?: boolean;
  }
): Promise<{ hasFiles: boolean; fileCount: number; hasPdf: boolean }> {
  if (!isGdriveConfigured(settings)) {
    return { hasFiles: false, fileCount: 0, hasPdf: false };
  }

  // parseDriveIdFromUrl handles both plain IDs and Drive URLs.
  const id = parseDriveIdFromUrl(folderId) ?? folderId.trim();
  if (!id) return { hasFiles: false, fileCount: 0, hasPdf: false };

  const drive = driveClient(settings);
  const listOpts = {
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  };

  // Run folder existence and live listing in parallel. Trashed items stay
  // in trash — never listed or restored on refresh.
  const [folderMeta, listing] = await Promise.all([
    drive.files
      .get({ fileId: id, fields: "id, trashed", supportsAllDrives: true })
      .then((r) => r.data)
      .catch(() => null as { id?: string | null; trashed?: boolean | null } | null),
    drive.files.list({
      q: [`'${id}' in parents`, "trashed=false"].join(" and "),
      fields: "files(id,mimeType,name,shortcutDetails(targetId,targetMimeType))",
      pageSize: 50,
      ...listOpts,
    }),
  ]);

  // Folder doesn't exist or couldn't be fetched.
  if (!folderMeta?.id) return { hasFiles: false, fileCount: 0, hasPdf: false };

  // Trashed folder — leave it in trash. Refreshing the board must not
  // undelete files a user just removed.
  if (folderMeta.trashed === true) {
    return { hasFiles: false, fileCount: 0, hasPdf: false };
  }

  const entries = listing.data.files ?? [];
  const directFiles = entries.filter((f) => f.mimeType !== FOLDER_MIME);
  const allDirectFiles = [...directFiles];
  if (allDirectFiles.length > 0) {
    return {
      hasFiles: true,
      fileCount: allDirectFiles.length,
      hasPdf: allDirectFiles.some((f) => isDrivePdfFile(f)),
    };
  }

  if (opts?.directOnly) {
    return { hasFiles: false, fileCount: 0, hasPdf: false };
  }

  const excludeChildIds = new Set(opts?.excludeChildIds ?? []);
  const skipFinal = opts?.skipFinalProdChildren === true;

  const childFolders = entries.filter((f) => {
    if (f.mimeType !== FOLDER_MIME || !f.id) return false;
    if (excludeChildIds.has(f.id)) return false;
    if (skipFinal && isFinalProdFolderName(f.name ?? "")) return false;
    return true;
  });
  if (childFolders.length === 0) {
    return { hasFiles: false, fileCount: 0, hasPdf: false };
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
        fields: "files(id,mimeType,name,shortcutDetails(targetMimeType))",
        pageSize: 20,
        ...listOpts,
      });
      const files = nestedRes.data.files ?? [];
      return {
        count: files.length,
        hasPdf: files.some((f) => isDrivePdfFile(f)),
      };
    })
  );

  const nestedCount = results.reduce((sum, n) => sum + n.count, 0);
  return {
    hasFiles: nestedCount > 0,
    fileCount: nestedCount,
    hasPdf: results.some((n) => n.hasPdf),
  };
}

export type DrivePdfRef = {
  id: string;
  name: string;
  modifiedTime: string;
};

function pdfRefFromFile(file: {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  modifiedTime?: string | null;
  shortcutDetails?: { targetId?: string | null; targetMimeType?: string | null } | null;
}): DrivePdfRef | null {
  if (!isDrivePdfFile(file) || !file.id) return null;
  const shortcutTarget = file.shortcutDetails?.targetId?.trim();
  return {
    id: shortcutTarget || file.id,
    name: file.name || "file.pdf",
    modifiedTime: file.modifiedTime || "",
  };
}

/**
 * Newest PDF in the given folders (direct files, then one nested folder level).
 */
export async function findLatestPdfInFolders(
  settings: GdriveSettings,
  folderIds: string[],
  opts?: { directOnly?: boolean }
): Promise<DrivePdfRef | null> {
  if (!isGdriveConfigured(settings) || folderIds.length === 0) return null;

  const drive = driveClient(settings);
  const listOpts = {
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  };
  const uniqueIds = [...new Set(folderIds.filter(Boolean))];
  const found: DrivePdfRef[] = [];

  for (const folderId of uniqueIds) {
    if (!(await isLiveDriveFolder(settings, folderId))) continue;
    const listing = await drive.files.list({
      q: [`'${folderId}' in parents`, "trashed=false"].join(" and "),
      fields:
        "files(id,mimeType,name,modifiedTime,shortcutDetails(targetId,targetMimeType))",
      pageSize: 50,
      ...listOpts,
    });
    const entries = listing.data.files ?? [];
    const directCount = found.length;
    for (const file of entries) {
      if (file.mimeType === FOLDER_MIME) continue;
      const ref = pdfRefFromFile(file);
      if (ref) found.push(ref);
    }

    if (found.length > directCount) continue;
    if (opts?.directOnly) continue;

    const childFolders = entries.filter(
      (f) => f.mimeType === FOLDER_MIME && f.id
    );
    const nested = await Promise.all(
      childFolders.map(async (child) => {
        const nestedRes = await drive.files.list({
          q: [
            `'${child.id}' in parents`,
            `mimeType!='${FOLDER_MIME}'`,
            "trashed=false",
          ].join(" and "),
          fields:
            "files(id,mimeType,name,modifiedTime,shortcutDetails(targetId,targetMimeType))",
          pageSize: 20,
          ...listOpts,
        });
        return (nestedRes.data.files ?? [])
          .map((f) => pdfRefFromFile(f))
          .filter((r): r is DrivePdfRef => r != null);
      })
    );
    for (const group of nested) found.push(...group);
  }

  if (found.length === 0) return null;
  found.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return found[0] ?? null;
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
