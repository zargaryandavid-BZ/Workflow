import {
  CATALOG_FIELD_TARGETS,
  applyCatalogReviewToOptions,
  clusterNeedsReview,
  normalizeOptionText,
  optionsAreDuplicates,
  optionsAreStrongTextMatch,
  productParentFamily,
  type CatalogOptionLists,
} from "@/lib/import-catalog";
import { openaiChatText, openaiConfigured } from "@/lib/openai";

export { applyCatalogReviewToOptions, clusterNeedsReview };

export type CatalogFieldKey = keyof CatalogOptionLists;

export type CatalogDuplicateGroup = {
  id: string;
  fieldKey: CatalogFieldKey;
  fieldName: string;
  /** Local option labels in this cluster */
  ours: string[];
  /** Catalog option labels in this cluster */
  catalog: string[];
  reason: string;
  source: "rules" | "ai";
  /** Default pick — catalog spelling when present */
  suggestedKeep: string[];
};

export type CatalogAddition = {
  id: string;
  fieldKey: CatalogFieldKey;
  fieldName: string;
  value: string;
};

export type CatalogFieldSnapshot = {
  fieldKey: CatalogFieldKey;
  fieldName: string;
  fieldId: string | null;
  fieldTypeOk: boolean;
  existing: string[];
  catalog: string[];
};

function newId() {
  return crypto.randomUUID();
}

/** AI can flag looser near-matches than naming rules (70% vs 90%). */
const AI_SIMILARITY_THRESHOLD = 0.7;

/**
 * Naming duplicates for the review UI — excludes parent catch-all ↔ specific
 * pairs (Apparel ↔ Leggings), which are merge rules, not spelling conflicts.
 */
function optionsAreNamingDuplicates(a: string, b: string): boolean {
  if (!optionsAreDuplicates(a, b)) return false;
  const pfa = productParentFamily(a);
  const pfb = productParentFamily(b);
  if (
    pfa &&
    pfb &&
    pfa.family === pfb.family &&
    pfa.kind !== pfb.kind
  ) {
    return false;
  }
  return true;
}

/** AI pair gate: rules match OR ≥70% text similarity (not parent↔specific). */
function optionsAreAiDuplicateCandidates(a: string, b: string): boolean {
  const pfa = productParentFamily(a);
  const pfb = productParentFamily(b);
  if (
    pfa &&
    pfb &&
    pfa.family === pfb.family &&
    pfa.kind !== pfb.kind
  ) {
    return false;
  }
  if (optionsAreNamingDuplicates(a, b)) return true;
  return optionsAreStrongTextMatch(a, b, AI_SIMILARITY_THRESHOLD);
}

/** Pair catalog options to local near-duplicates that actually differ in spelling. */
function buildRuleClusters(
  existing: string[],
  catalog: string[]
): { ours: string[]; catalog: string[] }[] {
  const groups: { ours: string[]; catalog: string[] }[] = [];
  const usedOurs = new Set<number>();

  for (const cat of catalog) {
    const exact: { index: number; value: string }[] = [];
    const near: { index: number; value: string }[] = [];

    for (let i = 0; i < existing.length; i++) {
      if (usedOurs.has(i)) continue;
      const value = existing[i]!;
      if (!optionsAreNamingDuplicates(value, cat)) continue;
      if (
        normalizeOptionText(value) === normalizeOptionText(cat) &&
        value.trim() === cat.trim()
      ) {
        exact.push({ index: i, value });
      } else {
        near.push({ index: i, value });
      }
    }

    if (near.length > 0) {
      for (const m of near) usedOurs.add(m.index);
      if (exact[0]) usedOurs.add(exact[0].index);
      groups.push({
        ours: near.map((m) => m.value),
        catalog: [cat],
      });
      continue;
    }

    if (exact[0]) {
      usedOurs.add(exact[0].index);
    }
  }

  return groups.filter((g) => clusterNeedsReview(g));
}

function uniqueCatalogNotInClusters(
  catalog: string[],
  clusters: { catalog: string[] }[]
): string[] {
  const inCluster = new Set(
    clusters.flatMap((c) => c.catalog.map((v) => normalizeOptionText(v)))
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of catalog) {
    const key = normalizeOptionText(v);
    if (!key || inCluster.has(key) || seen.has(key)) continue;
    // Also skip if exact/near match already exists locally outside clusters?
    // Additions = catalog rows with no local near-duplicate at all.
    seen.add(key);
    out.push(v);
  }
  return out;
}

function additionsAgainstExisting(
  catalog: string[],
  existing: string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of catalog) {
    const key = normalizeOptionText(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (existing.some((e) => optionsAreDuplicates(e, v))) continue;
    out.push(v);
  }
  return out;
}

async function aiExtraDuplicatePairs(
  fieldName: string,
  existing: string[],
  catalog: string[],
  alreadyPairedCatalog: Set<string>
): Promise<{
  pairs: { ours: string; catalog: string; reason: string }[];
  ran: boolean;
}> {
  if (!openaiConfigured()) return { pairs: [], ran: false };

  const remainingExisting = existing.slice(0, 200);
  const remainingCatalog = catalog
    .filter((c) => !alreadyPairedCatalog.has(normalizeOptionText(c)))
    .slice(0, 200);
  if (remainingExisting.length === 0 || remainingCatalog.length === 0) {
    return { pairs: [], ran: true };
  }

  const system = `You compare print-shop dropdown options for "${fieldName}".
Find near-duplicates where text and meaning match about 70%+
(same product/material under different spelling, singular/plural, trailing
parenthetical finish, or one name is the other plus a noise word like "Printing").
Do NOT pair clearly different products (Gift Bags vs paper bags, Standard vs
Premium cards, Poly Tape vs Packaging Tape, Signage vs Sign board, Wallpaper vs
Roll Labels, Sticker Sheets vs Labels Sheet, Individual Stickers vs Diecut).
Do NOT invent names — copy strings exactly from the lists.
Reply with JSON only: { "pairs": [ { "ours": string, "catalog": string, "reason": string } ] }
Max 40 pairs. Empty pairs array if none.`;

  const user = JSON.stringify({
    ours: remainingExisting,
    catalog: remainingCatalog,
  });

  try {
    const text = await openaiChatText({
      system,
      user,
      temperature: 0.1,
      maxTokens: 2500,
    });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pairs: [], ran: true };
    const parsed = JSON.parse(jsonMatch[0]) as {
      pairs?: { ours?: string; catalog?: string; reason?: string }[];
    };
    const pairs: { ours: string; catalog: string; reason: string }[] = [];
    for (const p of parsed.pairs ?? []) {
      if (
        typeof p.ours === "string" &&
        typeof p.catalog === "string" &&
        remainingExisting.includes(p.ours) &&
        remainingCatalog.includes(p.catalog) &&
        optionsAreAiDuplicateCandidates(p.ours, p.catalog)
      ) {
        pairs.push({
          ours: p.ours,
          catalog: p.catalog,
          reason: typeof p.reason === "string" ? p.reason : "Possible duplicate",
        });
      }
    }
    return { pairs, ran: true };
  } catch (err) {
    console.warn(
      "catalog import AI duplicate pass failed:",
      err instanceof Error ? err.message : err
    );
    return { pairs: [], ran: false };
  }
}

export async function buildCatalogImportReview(opts: {
  lists: CatalogOptionLists;
  fields: {
    id: string;
    name: string;
    field_type: string;
    options: string[] | null;
  }[];
}): Promise<{
  snapshots: CatalogFieldSnapshot[];
  duplicates: CatalogDuplicateGroup[];
  additions: CatalogAddition[];
  aiUsed: boolean;
  aiConfigured: boolean;
}> {
  const duplicates: CatalogDuplicateGroup[] = [];
  const additions: CatalogAddition[] = [];
  const snapshots: CatalogFieldSnapshot[] = [];
  const aiConfigured = openaiConfigured();
  let aiUsed = false;

  for (const target of CATALOG_FIELD_TARGETS) {
    const catalog = opts.lists[target.key];
    const match = opts.fields.find((f) =>
      target.aliases.includes(f.name.trim().toLowerCase())
    );
    const existing = [...(match?.options ?? [])].map((o) => o.trim()).filter(Boolean);
    const fieldName = match?.name ?? target.createName;
    const fieldTypeOk = !match || match.field_type === "select";

    snapshots.push({
      fieldKey: target.key,
      fieldName,
      fieldId: match?.id ?? null,
      fieldTypeOk,
      existing,
      catalog,
    });

    if (!fieldTypeOk || catalog.length === 0) continue;

    const clusters = buildRuleClusters(existing, catalog);
    // Exact matches + rule conflicts are done; AI only sees leftover catalog rows
    const pairedCatalog = new Set<string>();
    for (const cat of catalog) {
      const key = normalizeOptionText(cat);
      if (
        key &&
        existing.some((e) => normalizeOptionText(e) === key)
      ) {
        pairedCatalog.add(key);
      }
    }
    for (const c of clusters) {
      for (const v of c.catalog) pairedCatalog.add(normalizeOptionText(v));
    }

    for (const c of clusters) {
      const suggestedKeep =
        c.catalog.length > 0 ? [...c.catalog] : [...c.ours];
      duplicates.push({
        id: newId(),
        fieldKey: target.key,
        fieldName,
        ours: c.ours,
        catalog: c.catalog,
        reason: "≈90% text / meaning match",
        source: "rules",
        suggestedKeep,
      });
    }

    // AI pass for leftovers not already clustered
    const aiResult = await aiExtraDuplicatePairs(
      fieldName,
      existing,
      catalog,
      pairedCatalog
    );
    if (aiResult.ran) aiUsed = true;
    const aiPairs = aiResult.pairs;

    const usedOurs = new Set(clusters.flatMap((c) => c.ours.map(normalizeOptionText)));
    const usedCat = new Set(pairedCatalog);

    for (const pair of aiPairs) {
      const ok = normalizeOptionText(pair.ours);
      const ck = normalizeOptionText(pair.catalog);
      if (usedOurs.has(ok) || usedCat.has(ck)) continue;
      if (
        !clusterNeedsReview({ ours: [pair.ours], catalog: [pair.catalog] })
      ) {
        continue;
      }
      usedOurs.add(ok);
      usedCat.add(ck);
      duplicates.push({
        id: newId(),
        fieldKey: target.key,
        fieldName,
        ours: [pair.ours],
        catalog: [pair.catalog],
        reason: pair.reason || "AI · ≈70% text / meaning match",
        source: "ai",
        suggestedKeep: [pair.catalog],
      });
    }

    const toAdd = additionsAgainstExisting(catalog, existing).filter(
      (v) => !usedCat.has(normalizeOptionText(v))
    );
    const inDupCatalog = new Set(
      duplicates
        .filter((d) => d.fieldKey === target.key)
        .flatMap((d) => d.catalog.map((x) => normalizeOptionText(x)))
    );
    for (const v of toAdd) {
      if (inDupCatalog.has(normalizeOptionText(v))) continue;
      additions.push({
        id: newId(),
        fieldKey: target.key,
        fieldName,
        value: v,
      });
    }
  }

  void uniqueCatalogNotInClusters;

  return { snapshots, duplicates, additions, aiUsed, aiConfigured };
}
