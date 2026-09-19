/**
 * Restore a Drive file/folder (and trashed parents) so Workflow can keep
 * using the stored Final production id instead of creating an empty duplicate.
 */

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
      fields: "id,trashed,parents",
      supportsAllDrives: true,
    });
  } catch {
    return false;
  }
  if (!meta.data.id) return false;
  if (meta.data.trashed !== true) return true;

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
