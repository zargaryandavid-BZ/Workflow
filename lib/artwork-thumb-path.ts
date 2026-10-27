/** Storage path of the small thumbnail stored next to an artwork preview. */
export function artworkThumbPath(fullPath: string): string {
  const dot = fullPath.lastIndexOf(".");
  const slash = fullPath.lastIndexOf("/");
  const stem = dot > slash ? fullPath.slice(0, dot) : fullPath;
  return `${stem}.thumb.jpg`;
}
