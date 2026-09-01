/** CRM lead origin channels shown as a chip on the board card. */
export const SOURCE_CHANNEL_KEYS = [
  "email",
  "call",
  "sms",
  "webform",
  "ad_lead",
  "ig_dm",
] as const;

export type SourceChannelKey = (typeof SOURCE_CHANNEL_KEYS)[number];

const KEY_SET = new Set<string>(SOURCE_CHANNEL_KEYS);

export const SOURCE_CHANNEL_LABELS: Record<SourceChannelKey, string> = {
  email: "Email",
  call: "Call",
  sms: "SMS",
  webform: "Web form",
  ad_lead: "Ad",
  ig_dm: "Instagram",
};

/** Chip tones — same size/weight as DesignFlagChip. */
export const SOURCE_CHANNEL_TONES: Record<SourceChannelKey, string> = {
  email: "bg-sky-100 text-sky-700 border-sky-300",
  call: "bg-emerald-100 text-emerald-700 border-emerald-300",
  sms: "bg-teal-100 text-teal-700 border-teal-300",
  webform: "bg-indigo-100 text-indigo-700 border-indigo-300",
  ad_lead: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
  ig_dm: "bg-pink-100 text-pink-700 border-pink-300",
};

/**
 * Persist only known channels. Missing, empty, and unknown values become null
 * so ingest never throws and the chip stays hidden.
 */
export function normalizeSourceChannel(raw: unknown): SourceChannelKey | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (!v || !KEY_SET.has(v)) return null;
  return v as SourceChannelKey;
}

export function sourceChannelDisplay(
  raw: unknown
): { key: SourceChannelKey; label: string; tone: string } | null {
  const key = normalizeSourceChannel(raw);
  if (!key) return null;
  return {
    key,
    label: SOURCE_CHANNEL_LABELS[key],
    tone: SOURCE_CHANNEL_TONES[key],
  };
}

/**
 * When `initial_column` is absent/empty, older CRM payloads still land in
 * Missing Info if files are coming. An explicit (even unmatched) column name
 * skips this fallback so a typo falls back to the start column, not Missing Info.
 */
export function shouldApplyMissingInfoFallback(opts: {
  initialColumn: string | null | undefined;
  designSource: string | null | undefined;
  needsCustomerFiles: boolean;
}): boolean {
  if (typeof opts.initialColumn === "string" && opts.initialColumn.trim()) {
    return false;
  }
  if (opts.needsCustomerFiles) return true;
  return opts.designSource?.trim() === "files_coming";
}
