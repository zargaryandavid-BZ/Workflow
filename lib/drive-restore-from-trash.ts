/**
 * Restore a trashed Drive FOLDER (and its trashed parent folders) so Workflow
 * can keep using the stored Final production folder id instead of creating an
 * empty duplicate.
 *
 * It never un-trashes a FILE. A file a user moved to trash was deleted
 * intentionally and must stay deleted — restoring it is what made deletions
 * "kick back". Only folders are restored.
 */

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveTrashClient = {
  files: {
    get: (params: {
      fileId: string;
      fields: string;
      supportsAllDrives: boolean;
    }) => Promise<{
      data: {
        id?: string | null;
        trashed?: boolean | null;
        parents?: (string | null)[] | null;
        mimeType?: string | null;
      };
    }>;
    update: (params: {
      fileId: string;
      requestBody: { trashed: boolean };
      supportsAllDrives: boolean;
      fields: string;
    }) => Promise<{ data: { id?: string | null; trashed?: boolean | null } }>;
  };
};

export async function restoreDriveFileFromTrash(
  drive: DriveTrashClient,
  fileId: string,
  visited: Set<string> = new Set()
): Promise<boolean> {
  const id = fileId.trim();
  if (!id || visited.has(id)) return visited.has(id);
  visited.add(id);

  let meta: Awaited<ReturnType<DriveTrashClient["files"]["get"]>>;
  try {
    meta = await drive.files.get({
      fileId: id,
      fields: "id,trashed,parents,mimeType",
      supportsAllDrives: true,
    });
  } catch {
    return false;
  }
  if (!meta.data.id) return false;
  if (meta.data.trashed !== true) return true;

  // Never resurrect a trashed FILE — only folders are restored. A file the user
  // moved to trash stays deleted, no matter which caller asked to restore it.
  if (meta.data.mimeType !== DRIVE_FOLDER_MIME) return false;

  const parents = (meta.data.parents ?? []).filter(Boolean) as string[];
  for (const parent of parents) {
    await restoreDriveFileFromTrash(drive, parent, visited);
  }

  try {
    const updated = await drive.files.update({
      fileId: id,
      requestBody: { trashed: false },
      supportsAllDrives: true,
      fields: "id,trashed",
    });
    return Boolean(updated.data.id) && updated.data.trashed !== true;
  } catch (err) {
    console.warn(
      `[gdrive] could not restore ${id} from trash:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
