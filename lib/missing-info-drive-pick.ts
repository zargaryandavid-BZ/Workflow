/**
 * Pure picks for the Missing Info Drive sweep (lib/missing-info-drive-sweep.ts).
 *
 * Why: broker-portal customers upload artwork straight into the order's Drive
 * job folder (e.g. "685_Safe Care Packaging"), while each Workflow card opens
 * its own per-item subfolder ("685_Safe Care Packaging_1"). Files in the job
 * folder root were invisible to designers, and a portal upload never moved a
 * Missing Info card back the way the Workflow missing-info link does.
 *
 * Dependency-free so it can be unit-tested in isolation.
 */

export const MIRROR_PROP = "bzMirrorOf";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export type SweepDriveFile = {
  id: string;
  name: string;
  mimeType?: string | null;
  createdTime?: string | null;
  appProperties?: Record<string, string> | null;
  lastModifyingUser?: { emailAddress?: string | null } | null;
  owners?: { emailAddress?: string | null }[] | null;
};

/** "685_Safe Care Packaging_1" — a per-item folder inside a job folder. */
export function isPerItemFolderName(name: string | null | undefined): boolean {
  const n = String(name ?? "").trim();
  if (!n || /finalprod$/i.test(n)) return false;
  return /_\d+$/.test(n);
}

export function isFolder(f: { mimeType?: string | null }): boolean {
  return (f.mimeType ?? "") === FOLDER_MIME;
}

/**
 * Loose files in the job folder root that this item folder does not have yet.
 * Skips folders, files already mirrored (by source id), and any file the item
 * folder already holds under the same name (someone copied it by hand).
 */
export function pickFilesToMirror(
  parentFiles: SweepDriveFile[],
  itemFiles: SweepDriveFile[]
): SweepDriveFile[] {
  const mirrored = new Set(
    itemFiles
      .map((f) => f.appProperties?.[MIRROR_PROP])
      .filter((v): v is string => typeof v === "string" && v.length > 0)
  );
  const names = new Set(itemFiles.map((f) => f.name.trim().toLowerCase()));
  return parentFiles.filter(
    (f) =>
      !isFolder(f) &&
      !mirrored.has(f.id) &&
      !names.has(f.name.trim().toLowerCase())
  );
}

function uploaderEmail(f: SweepDriveFile): string {
  const e =
    f.lastModifyingUser?.emailAddress ?? f.owners?.[0]?.emailAddress ?? "";
  return e.trim().toLowerCase();
}

/**
 * A file the customer added: not a folder, not our own mirror copy, not made
 * by the Drive service account or a Workflow team member.
 */
export function isCustomerUpload(
  f: SweepDriveFile,
  staffEmails: Set<string>
): boolean {
  if (isFolder(f)) return false;
  if (f.appProperties?.[MIRROR_PROP]) return false;
  const email = uploaderEmail(f);
  if (!email) return true; // anonymous "anyone with the link" upload
  if (email.endsWith(".iam.gserviceaccount.com")) return false;
  return !staffEmails.has(email);
}

/** Customer files added after the card entered Missing Info. */
export function newCustomerFilesSince(
  files: SweepDriveFile[],
  sinceIso: string | null | undefined,
  staffEmails: Set<string>
): SweepDriveFile[] {
  const since = sinceIso ? new Date(sinceIso).getTime() : NaN;
  return files.filter((f) => {
    if (!isCustomerUpload(f, staffEmails)) return false;
    if (!Number.isFinite(since)) return false;
    const t = f.createdTime ? new Date(f.createdTime).getTime() : NaN;
    return Number.isFinite(t) && t > since;
  });
}
