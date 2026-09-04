export const ROLL_DIRECTION_VALUES = [
  "1-Top",
  "2-Bottom",
  "3-Right",
  "4-Left",
] as const;

export type RollDirectionValue = (typeof ROLL_DIRECTION_VALUES)[number];

export type RollDirectionOption = {
  value: RollDirectionValue;
  label: string;
  src: string;
};

export const ROLL_DIRECTION_OPTIONS: RollDirectionOption[] = [
  { value: "1-Top", label: "1-Top", src: "/roll-direction/1-top.png" },
  { value: "2-Bottom", label: "2-Bottom", src: "/roll-direction/2-bottom.png" },
  { value: "3-Right", label: "3-Right", src: "/roll-direction/3-right.png" },
  { value: "4-Left", label: "4-Left", src: "/roll-direction/4-left.png" },
];

const VALUE_SET = new Set<string>(ROLL_DIRECTION_VALUES);

export function isRollDirectionFieldName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "roll direction" || n === "position";
}

export function isRollDirectionField(field: {
  name: string;
  options?: string[] | null;
}): boolean {
  if (isRollDirectionFieldName(field.name)) return true;
  return (field.options ?? []).some((o) => VALUE_SET.has(o.trim()));
}

export function rollDirectionOption(
  value: string | null | undefined
): RollDirectionOption | null {
  const canonical = normalizeRollDirectionValue(value);
  if (!canonical) return null;
  return ROLL_DIRECTION_OPTIONS.find((o) => o.value === canonical) ?? null;
}

/** Rotate artwork on the hanging web so unwind matches 1-Top … 4-Left. */
export function rollDirectionArtworkRotateDeg(
  value: RollDirectionValue
): number {
  switch (value) {
    case "1-Top":
      return 0;
    case "2-Bottom":
      return 180;
    case "3-Right":
      return 90;
    case "4-Left":
      return -90;
  }
}

/**
 * Artwork in the proof already matches the order's Roll Direction.
 * Preview buttons change that angle; they do not set an absolute unwind.
 */
export function rollDirectionPreviewRotateDeg(
  orderDirection: RollDirectionValue,
  previewDirection: RollDirectionValue
): number {
  return (
    rollDirectionArtworkRotateDeg(previewDirection) -
    rollDirectionArtworkRotateDeg(orderDirection)
  );
}

/** e.g. `+90°`, `-90°`, `0°`, `+180°`. */
export function formatRollDirectionPreviewAngle(deg: number): string {
  let n = ((Math.round(deg) % 360) + 360) % 360;
  if (n > 180) n -= 360;
  if (n === 0) return "0°";
  return n > 0 ? `+${n}°` : `${n}°`;
}

export function rollDirectionPrintCaption(
  value: RollDirectionValue
): string {
  switch (value) {
    case "1-Top":
      return "Top of copy off first";
    case "2-Bottom":
      return "Bottom of copy off first";
    case "3-Right":
      return "Right of copy off first";
    case "4-Left":
      return "Left of copy off first";
  }
}

export function rollDirectionFromRespondRows(
  rows: { label: string; value: string }[]
): RollDirectionValue | null {
  for (const row of rows) {
    if (!isRollDirectionFieldName(row.label)) continue;
    const next = normalizeRollDirectionValue(row.value);
    if (next) return next;
  }
  return null;
}

/** CRM / catalog aliases → `1-Top` … `4-Left`. */
export function normalizeRollDirectionValue(
  raw: unknown
): RollDirectionValue | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (VALUE_SET.has(t)) return t as RollDirectionValue;
  const compact = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/^1\b/.test(compact) || /\btop\b/.test(compact)) return "1-Top";
  if (/^2\b/.test(compact) || /\bbottom\b/.test(compact)) return "2-Bottom";
  if (/^3\b/.test(compact) || /\bright\b/.test(compact)) return "3-Right";
  if (/^4\b/.test(compact) || /\bleft\b/.test(compact)) return "4-Left";
  return null;
}
