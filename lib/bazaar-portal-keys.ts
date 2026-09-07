/**
 * Persisted shape for webhook_configs.bazaar_portal_inbound_keys:
 *   { "<brokerId>": "osk_…" }                         // legacy
 *   { "<brokerId>": { "osk": "osk_…", "label": "…", "mode": "send_receive" } }
 */

export type BazaarConnectMode = "send_receive" | "receive_only";

export type BazaarPortalPartnerEntry = {
  osk: string;
  label: string;
  mode?: BazaarConnectMode;
};

export function parseConnectModeValue(
  raw: unknown
): BazaarConnectMode | undefined {
  return raw === "send_receive" || raw === "receive_only" ? raw : undefined;
}

export function parseBazaarPortalInboundKeys(raw: unknown): {
  keys: Record<string, string>;
  labels: Record<string, string>;
  modes: Record<string, BazaarConnectMode>;
} {
  const keys: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const modes: Record<string, BazaarConnectMode> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { keys, labels, modes };
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
      const mode = parseConnectModeValue(row.mode);
      if (mode) modes[brokerId] = mode;
    }
  }

  return { keys, labels, modes };
}

/** Serialize for DB — always object form so partner names and mode survive refresh. */
export function serializeBazaarPortalInboundKeys(
  entries: Array<{
    brokerId: string;
    osk: string;
    label?: string;
    mode?: BazaarConnectMode;
  }>
): Record<string, BazaarPortalPartnerEntry> | null {
  const out: Record<string, BazaarPortalPartnerEntry> = {};
  for (const e of entries) {
    const brokerId = e.brokerId.trim();
    const osk = e.osk.trim();
    if (!brokerId && !osk) continue;
    if (!brokerId || !osk.startsWith("osk_")) return null;
    const row: BazaarPortalPartnerEntry = {
      osk,
      label: (e.label ?? "").trim(),
    };
    if (e.mode) row.mode = e.mode;
    out[brokerId] = row;
  }
  return out;
}

/** Inbound = orders into Workflow. Outbound = status back to Admin. */
export function partnerDirectionLabel(
  mode: BazaarConnectMode | undefined
): "Inbound" | "Outbound" | "Both" {
  if (mode === "receive_only") return "Outbound";
  return "Both";
}
