/**
 * Keep pixels that differ from the all-OCG-off render so stacked layer PNGs
 * do not double-draw always-on artwork.
 */
export function ocgOverlayRgba(
  full: Uint8Array,
  base: Uint8Array,
  threshold = 12
): Uint8Array {
  const n = Math.min(full.length, base.length);
  const out = new Uint8Array(n);
  for (let i = 0; i + 3 < n; i += 4) {
    const dr = Math.abs(full[i]! - base[i]!);
    const dg = Math.abs(full[i + 1]! - base[i + 1]!);
    const db = Math.abs(full[i + 2]! - base[i + 2]!);
    if (dr + dg + db < threshold) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }
    out[i] = full[i]!;
    out[i + 1] = full[i + 1]!;
    out[i + 2] = full[i + 2]!;
    out[i + 3] = 255;
  }
  return out;
}
