export interface WebhookSourceStyleEntry {
  key: string;
  label: string;
  color: string;
}

export interface WebhookSourceStyles {
  sources: WebhookSourceStyleEntry[];
  other: { label: string; color: string };
}

export const DEFAULT_WEBHOOK_SOURCE_STYLES: WebhookSourceStyles = {
  sources: [],
  other: { label: "Webhook", color: "#64748b" },
};

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value.trim());
}

export function normalizeHexColor(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return v.toLowerCase();
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

export function parseWebhookSourceKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

/** Normalize / validate inbound source_styles from API or DB. */
export function normalizeWebhookSourceStyles(
  input: unknown
): WebhookSourceStyles {
  const fallback = DEFAULT_WEBHOOK_SOURCE_STYLES;
  if (!input || typeof input !== "object") return { ...fallback, other: { ...fallback.other } };

  const raw = input as Record<string, unknown>;
  const sourcesRaw = Array.isArray(raw.sources) ? raw.sources : [];
  const seen = new Set<string>();
  const sources: WebhookSourceStyleEntry[] = [];

  for (const row of sourcesRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.key !== "string" || !r.key.trim()) continue;
    if (typeof r.label !== "string" || !r.label.trim()) continue;
    if (!isHexColor(r.color)) continue;
    const key = normalizeKey(r.key);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      key,
      label: r.label.trim(),
      color: normalizeHexColor(r.color),
    });
  }

  const otherRaw =
    raw.other && typeof raw.other === "object"
      ? (raw.other as Record<string, unknown>)
      : {};
  const otherLabel =
    typeof otherRaw.label === "string" && otherRaw.label.trim()
      ? otherRaw.label.trim()
      : fallback.other.label;
  const otherColor = isHexColor(otherRaw.color)
    ? normalizeHexColor(otherRaw.color)
    : fallback.other.color;

  return {
    sources,
    other: { label: otherLabel, color: otherColor },
  };
}

export function resolveWebhookSourceStyle(
  webhookSource: string | null | undefined,
  styles: WebhookSourceStyles | null | undefined
): { label: string; color: string } | null {
  if (webhookSource == null) return null;
  const cfg = styles ?? DEFAULT_WEBHOOK_SOURCE_STYLES;
  const key = normalizeKey(webhookSource);
  if (key) {
    const match = cfg.sources.find((s) => s.key === key);
    if (match) return { label: match.label, color: match.color };
  }
  return { label: cfg.other.label, color: cfg.other.color };
}
