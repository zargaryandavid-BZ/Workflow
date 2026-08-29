/** CRM Files / line-item Google Drive folder URLs on the order webhook. */
const LINE_FOLDER_KEYS = [
  "files_url",
  "item_folder_url",
  "gdrive_folder_url",
  "drive_folder_url",
  "folder_url",
] as const;

export function httpUrlOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Prefer CRM line Files folder URLs. Falls back to `design_task` when that is
 * already an http(s) link. Empty/missing → Workflow may create a Drive folder.
 */
export function resolveWebhookLineFolderUrl(
  item?: Record<string, unknown> | null,
  order?: Record<string, unknown> | null
): string | null {
  for (const bag of [item, order]) {
    if (!bag) continue;
    for (const key of LINE_FOLDER_KEYS) {
      const url = httpUrlOrNull(bag[key]);
      if (url) return url;
    }
  }
  for (const bag of [item, order]) {
    if (!bag) continue;
    const url = httpUrlOrNull(bag.design_task);
    if (url) return url;
  }
  return null;
}

/** True when the card already has a CRM (or webhook) Drive folder to reuse. */
export function driveFolderUrlFromOrderSpecs(
  specs: Record<string, unknown> | null | undefined
): string | null {
  if (!specs) return null;
  return (
    httpUrlOrNull(specs.gdrive_item_folder_url) ||
    httpUrlOrNull(specs.design_task)
  );
}
