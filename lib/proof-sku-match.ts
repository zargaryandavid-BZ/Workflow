// Match designer proof files to order SKUs by version name — deterministic,
// no LLM. Mirrors the intake version-splitter's cleaning so the token a SKU
// was named from lines up with the token in the finished file's name.

import type { SkuItem } from "@/lib/skus";
import type { ProofFile } from "@/lib/gdrive-proofs";

const STOPWORDS = new Set([
  "purus", "hm", "organic", "label", "labels",
  "cap", "caps", "capsule", "capsules", "oz",
  "men", "women", "front", "back",
]);

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

/**
 * Reduce a file/SKU name to a comparable version token. Splits separators AND
 * camelCase AND digit/letter runs into words, drops brand/size/label stopwords
 * and bare numbers, then rejoins — so "Purus_2ozLabel_HM_Organic_Adrenal" and
 * the SKU "Adrenal" both collapse to "adrenal".
 */
export function versionToken(raw: string): string {
  const stem = raw.slice(0, raw.length - ext(raw).length);
  const words = stem
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .filter((w) => !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .join("");
}

/** Size token used to disambiguate cross-item collisions (e.g. "2oz", "90cap"). */
export function sizeToken(raw: string): string {
  const m = raw.toLowerCase().match(/(\d+\s*oz|\d+\s*cap)/);
  return m ? m[1].replace(/\s+/g, "") : "";
}

export type ProofMatch = {
  skuId: string;
  skuName: string;
  file: ProofFile;
};

export type MatchResult = {
  matches: ProofMatch[];
  /** Files that matched no SKU. */
  unmatched: ProofFile[];
  /** SKUs that got no file. */
  unfilledSkus: { id: string; name: string }[];
};

/**
 * Best-effort file→SKU pairing.
 * @param cardSizeToken optional size token of THIS card (from title/product),
 *   used to prefer the right file when one version name exists in several sizes.
 */
export function matchProofsToSkus(
  files: ProofFile[],
  skus: SkuItem[],
  cardSizeToken = ""
): MatchResult {
  const byToken = new Map<string, ProofFile[]>();
  for (const f of files) {
    const t = versionToken(f.name);
    if (!t) continue;
    if (!byToken.has(t)) byToken.set(t, []);
    byToken.get(t)!.push(f);
  }

  const matches: ProofMatch[] = [];
  const usedFileIds = new Set<string>();
  const unfilledSkus: { id: string; name: string }[] = [];
  const size = cardSizeToken.replace(/\s+/g, "").toLowerCase();

  for (const sku of skus) {
    const t = versionToken(sku.name);
    const candidates = (t && byToken.get(t)) || [];
    const fresh = candidates.filter((c) => !usedFileIds.has(c.id));
    if (fresh.length === 0) {
      unfilledSkus.push({ id: sku.id, name: sku.name });
      continue;
    }
    // Prefer a file whose name carries this card's size token.
    const preferred =
      (size && fresh.find((c) => sizeToken(c.name) === size)) || fresh[0];
    usedFileIds.add(preferred.id);
    matches.push({ skuId: sku.id, skuName: sku.name, file: preferred });
  }

  const unmatched = files.filter((f) => !usedFileIds.has(f.id));
  return { matches, unmatched, unfilledSkus };
}
