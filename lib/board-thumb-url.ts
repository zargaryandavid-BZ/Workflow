/**
 * Board card pictures are shown in a 112px box, but the signed Supabase URL
 * points at the full uploaded file (often several MB). This maps such a URL
 * to the small-thumbnail endpoint (/api/thumb). Anything that isn't an
 * order-assets signed URL (Drive links, CRM file links) is returned as-is.
 * The card falls back to the original URL if the thumbnail fails to load.
 */
const SIGNED_PATH_RE = /\/storage\/v1\/object\/sign\/order-assets\/([^?#]+)/;

export const BOARD_THUMB_WIDTH = 224; // 112px box at 2x for sharp screens

export function boardThumbSrc(url: string, width = BOARD_THUMB_WIDTH): string {
  if (!url) return url;
  const m = SIGNED_PATH_RE.exec(url);
  if (!m) return url;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return url;
  }
  if (!path || path.includes("..")) return url;
  if (/\.(svg|gif)$/i.test(path)) return url; // vector / animated: leave alone
  return `/api/thumb?w=${width}&p=${encodeURIComponent(path)}`;
}
