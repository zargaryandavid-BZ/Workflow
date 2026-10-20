/**
 * Staff SKU edits vs. CRM / website (portal) re-syncs.
 *
 * SKUs live on `orders.specs.skus` ([{ id, name, qty }]). Staff edit them in
 * the card detail (PATCH /api/orders/[id] or POST /api/orders/[id]/skus); CRM
 * and the website re-fire the order webhook whenever the order is edited
 * upstream (`refreshPortalOrdersFromWebhook`).
 *
 * Rule (all bookkeeping lives inside the same `specs` JSON — no migration):
 * - Every inbound SKU list that reaches a card is fingerprinted (name + qty per
 *   row, in order) into `specs.skus_inbound_fingerprint`.
 * - When staff change SKU names/quantities/rows, `specs.skus_staff_edited_at`
 *   (+ `skus_staff_edited_by`) is stamped.
 * - On re-sync, a staff-edited list is KEPT when the inbound SKU list is the
 *   same as what was last received (the source did not touch SKUs — it re-fired
 *   for a due date, notes, contact, etc.). If the source actually changed its
 *   SKU list, the source wins: inbound SKUs are applied and the staff flag is
 *   cleared. Orders edited by staff before this rule existed have no stored
 *   fingerprint; for those the staff list is kept and the fingerprint is
 *   recorded so the next real upstream change goes through.
 * - Whenever inbound SKUs are applied, existing SKU ids are reused (same name,
 *   else same position) so per-SKU artwork / gallery links stay attached.
 *
 * Pure helpers only (no Supabase / Next imports) so node:test can load them.
 */
import type { SkuItem } from "./skus";

export const SKU_STAFF_EDITED_AT_KEY = "skus_staff_edited_at";
export const SKU_STAFF_EDITED_BY_KEY = "skus_staff_edited_by";
export const SKU_INBOUND_FINGERPRINT_KEY = "skus_inbound_fingerprint";

/** Server-owned spec keys a client save must never overwrite. */
export const SKU_SYNC_SPEC_KEYS = [
  SKU_STAFF_EDITED_AT_KEY,
  SKU_STAFF_EDITED_BY_KEY,
  SKU_INBOUND_FINGERPRINT_KEY,
] as const;

type SkuLike = { id?: unknown; name?: unknown; qty?: unknown };

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanQty(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asSkuArray(value: unknown): SkuLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is SkuLike => typeof v === "object" && v !== null
  );
}

/**
 * Content fingerprint of a SKU list: ordered (name, qty) pairs. Ids are
 * ignored (inbound ids are minted fresh on every webhook).
 */
export function skuContentFingerprint(skus: unknown): string {
  return JSON.stringify(
    asSkuArray(skus).map((s) => [cleanName(s.name), cleanQty(s.qty)])
  );
}

/** True when two SKU lists differ in rows, names, or quantities. */
export function skuContentChanged(prev: unknown, next: unknown): boolean {
  return skuContentFingerprint(prev) !== skuContentFingerprint(next);
}

/** Total units across SKU rows (blank / invalid qty counts as 0). */
export function skuTotalQty(skus: readonly { qty: number | null }[]): number {
  return skus.reduce(
    (sum, s) =>
      sum + (typeof s.qty === "number" && Number.isFinite(s.qty) ? s.qty : 0),
    0
  );
}

export function isStaffEditedSkus(specs: Record<string, unknown>): boolean {
  const v = specs[SKU_STAFF_EDITED_AT_KEY];
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Keep server-owned SKU sync keys from the stored specs (a client may post a
 * stale copy of specs loaded before a re-sync updated them).
 */
export function preserveSkuSyncKeys(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...next };
  for (const key of SKU_SYNC_SPEC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) {
      out[key] = existing[key];
    } else {
      delete out[key];
    }
  }
  return out;
}

/**
 * Staff save path: preserve sync keys, then stamp the staff-edited flag when
 * the SKU content (rows / names / qty) actually changed. Other spec keys are
 * passed through untouched.
 */
export function applyStaffSkuEdit(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
  opts: { userId?: string | null; now?: Date } = {}
): Record<string, unknown> {
  const out = preserveSkuSyncKeys(existing, next);
  if (!Object.prototype.hasOwnProperty.call(next, "skus")) return out;
  if (!skuContentChanged(existing.skus, next.skus)) return out;
  out[SKU_STAFF_EDITED_AT_KEY] = (opts.now ?? new Date()).toISOString();
  if (opts.userId) out[SKU_STAFF_EDITED_BY_KEY] = opts.userId;
  else delete out[SKU_STAFF_EDITED_BY_KEY];
  return out;
}

/**
 * Map each incoming SKU to an existing SKU id: same name (case-insensitive)
 * first, then same position. Unmatched rows keep their own id.
 */
export function matchSkuIds(
  existing: readonly SkuItem[],
  incoming: readonly SkuItem[]
): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const unmatched: number[] = [];

  incoming.forEach((sku, i) => {
    const key = sku.name.trim().toLowerCase();
    const hit = key
      ? existing.find(
          (e) => !used.has(e.id) && e.name.trim().toLowerCase() === key
        )
      : undefined;
    if (hit) {
      used.add(hit.id);
      map.set(sku.id, hit.id);
    } else {
      unmatched.push(i);
    }
  });

  for (const i of unmatched) {
    const sku = incoming[i]!;
    const byPos = existing[i];
    if (byPos && !used.has(byPos.id)) {
      used.add(byPos.id);
      map.set(sku.id, byPos.id);
    } else {
      map.set(sku.id, sku.id);
    }
  }
  return map;
}

export type InboundSkuResync = {
  /** SKU list to store, or null to leave `specs.skus` untouched. */
  skus: SkuItem[] | null;
  /** The SKU list the card ends up with (for qty fields / artwork). */
  effectiveSkus: SkuItem[];
  /** inbound sku id → id on the card (artwork remap). */
  idMap: Map<string, string>;
  keptStaffEdit: boolean;
  /** Spec keys to set; `undefined` value = delete the key. */
  specsPatch: Record<string, unknown>;
};

/**
 * Decide what a CRM / website re-sync does to `specs.skus`.
 * `inbound` is the already-normalized inbound list (fresh ids).
 * `existingSkus` is the card's current normalized list.
 */
export function resolveInboundSkuResync(args: {
  existingSpecs: Record<string, unknown>;
  existingSkus: SkuItem[];
  inbound: SkuItem[];
}): InboundSkuResync {
  const { existingSpecs, existingSkus, inbound } = args;

  // Nothing inbound: keep today's behavior (never clear SKUs on re-fire).
  if (inbound.length === 0) {
    return {
      skus: null,
      effectiveSkus: existingSkus,
      idMap: new Map(),
      keptStaffEdit: false,
      specsPatch: {},
    };
  }

  const fp = skuContentFingerprint(inbound);
  const lastFp = existingSpecs[SKU_INBOUND_FINGERPRINT_KEY];
  const idMap = matchSkuIds(existingSkus, inbound);

  if (
    isStaffEditedSkus(existingSpecs) &&
    (typeof lastFp !== "string" || lastFp === fp)
  ) {
    return {
      skus: null,
      effectiveSkus: existingSkus,
      idMap,
      keptStaffEdit: true,
      specsPatch: { [SKU_INBOUND_FINGERPRINT_KEY]: fp },
    };
  }

  const skus = inbound.map((s) => ({ ...s, id: idMap.get(s.id) ?? s.id }));
  return {
    skus,
    effectiveSkus: skus,
    idMap,
    keptStaffEdit: false,
    specsPatch: {
      [SKU_INBOUND_FINGERPRINT_KEY]: fp,
      [SKU_STAFF_EDITED_AT_KEY]: undefined,
      [SKU_STAFF_EDITED_BY_KEY]: undefined,
    },
  };
}

/** Apply a `specsPatch` (undefined → delete) onto a specs object in place. */
export function applySpecsPatch(
  specs: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete specs[k];
    else specs[k] = v;
  }
  return specs;
}
