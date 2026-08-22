/**
 * Persisted shape for webhook_configs.bazaar_portal_inbound_keys:
 *   { "<brokerId>": "osk_…" }                         // legacy
 *   { "<brokerId>": { "osk": "osk_…", "label": "…" } } // current (label optional)
 */

export type BazaarPortalPartnerEntry = {
  osk: string;
  label: string;
};

export function parseBazaarPortalInboundKeys(raw: unknown): {
  keys: Record<string, string>;
  labels: Record<string, string>;
} {
  const keys: Record<string, string> = {};
  const labels: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { keys, labels };
  }

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const brokerId = String(k).trim();
    if (!brokerId) continue;

    if (typeof v === "string" && v.trim().startsWith("osk_")) {
      keys[brokerId] = v.trim();
      continue;
    }

    if (v && typeof v === "object" && !Array.isArray(v)) {
      const row = v as Record<string, unknown>;
      const osk =
        typeof row.osk === "string"
          ? row.osk.trim()
          : typeof row.key === "string"
            ? row.key.trim()
            : "";
      if (!osk.startsWith("osk_")) continue;
      keys[brokerId] = osk;
      const label = typeof row.label === "string" ? row.label.trim() : "";
      if (label) labels[brokerId] = label;
    }
  }

  return { keys, labels };
}

/** Serialize for DB — always object form so partner names survive refresh. */
export function serializeBazaarPortalInboundKeys(
  entries: Array<{ brokerId: string; osk: string; label?: string }>
): Record<string, BazaarPortalPartnerEntry> | null {
  const out: Record<string, BazaarPortalPartnerEntry> = {};
  for (const e of entries) {
    const brokerId = e.brokerId.trim();
    const osk = e.osk.trim();
    if (!brokerId && !osk) continue;
    if (!brokerId || !osk.startsWith("osk_")) return null;
    out[brokerId] = {
      osk,
      label: (e.label ?? "").trim(),
    };
  }
  return out;
}
