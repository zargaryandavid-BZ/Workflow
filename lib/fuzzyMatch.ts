/**
 * Fuzzy-match an incoming string against a list of valid options.
 * Returns the best matching option if similarity >= threshold, otherwise null.
 *
 * Algorithm: normalized word-token overlap + character-level Jaro-Winkler.
 * No external dependencies.
 *
 * @param input     The string sent in the webhook payload
 * @param options   Array of valid option strings (from Custom Fields)
 * @param threshold Minimum similarity to accept (0–1). Default 0.82
 */
export function fuzzyMatch(
  input: string | null | undefined,
  options: string[],
  threshold = 0.82
): { matched: string; score: number } | null {
  if (!input?.trim() || options.length === 0) return null;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/['']/g, "'")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const norm = normalize(input);

  for (const opt of options) {
    if (normalize(opt) === norm) return { matched: opt, score: 1.0 };
  }

  let best: { matched: string; score: number } | null = null;

  for (const opt of options) {
    const normOpt = normalize(opt);
    const score = similarity(norm, normOpt);
    if (score >= threshold && (!best || score > best.score)) {
      best = { matched: opt, score };
    }
  }

  return best;
}

function similarity(a: string, b: string): number {
  const token = tokenOverlap(a, b);
  const jaro = jaroWinkler(a, b);
  // Prefer the stronger signal — averaging under-scores single-token typos
  // (e.g. "role" vs "roll") while still requiring both to stay conservative.
  return Math.max(token, jaro);
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return (2 * common) / (ta.size + tb.size);
}

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / len1 +
      matches / len2 +
      (matches - transpositions / 2) / matches) /
    3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}
