export type MentionableMember = { id: string; fullName: string };

type LabelHit = { id: string; label: string };

function mentionLabels(members: MentionableMember[]): LabelHit[] {
  const named = members
    .map((m) => ({ id: m.id, fullName: m.fullName.trim() }))
    .filter((m) => m.fullName.length > 0);

  const firstCounts = new Map<string, number>();
  for (const m of named) {
    const first = m.fullName.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!first) continue;
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
  }

  const hits: LabelHit[] = [];
  for (const m of named) {
    hits.push({ id: m.id, label: m.fullName });
    const first = m.fullName.split(/\s+/)[0] ?? "";
    if (
      first.length >= 2 &&
      first.toLowerCase() !== m.fullName.toLowerCase() &&
      firstCounts.get(first.toLowerCase()) === 1
    ) {
      hits.push({ id: m.id, label: first });
    }
  }

  hits.sort((a, b) => b.label.length - a.label.length);
  return hits;
}

function isMentionBoundary(ch: string | undefined): boolean {
  return ch == null || /[\s.,!?;:)\]}'"]/.test(ch);
}

/**
 * Rank for the @ picker. Lower is better.
 * Prefix on first name / any token beats a substring in the middle of a name
 * (so `@Gar` highlights Gary, not Davit Zargaryan).
 */
export function mentionMatchScore(fullName: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  const lower = fullName.trim().toLowerCase();
  if (!lower) return null;
  if (!q) return 50;
  if (lower === q) return 0;
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens[0]?.startsWith(q)) return 1;
  if (tokens.some((t) => t.startsWith(q))) return 2;
  if (lower.startsWith(q)) return 3;
  if (lower.includes(q)) return 20;
  return null;
}

/** Members shown in the @ list, best match first (index 0 is the default pick). */
export function filterMentionMembers(
  members: MentionableMember[],
  query: string
): MentionableMember[] {
  const scored = members
    .map((m) => ({ m, score: mentionMatchScore(m.fullName, query) }))
    .filter((row): row is { m: MentionableMember; score: number } => row.score != null);
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.m.fullName.localeCompare(b.m.fullName, undefined, {
      sensitivity: "base",
    });
  });
  return scored.map((row) => row.m);
}

/** Active `@query` at the caret (spaces allowed so `@First Last` can be typed). */
export function mentionQueryAtCursor(
  value: string,
  cursor: number
): { start: number; query: string } | null {
  const pos = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, pos);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[A-Za-z0-9._]/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n") || query.length > 80) return null;
  return { start: at, query };
}

/**
 * User ids @mentioned in `text`, matched against teammate display names
 * (longest label first). Skips `@` in the middle of a word (e.g. emails).
 */
export function mentionedUserIds(
  text: string,
  members: MentionableMember[]
): string[] {
  if (!text || members.length === 0) return [];
  const labels = mentionLabels(members);
  const found = new Set<string>();

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    if (i > 0 && /[A-Za-z0-9._]/.test(text[i - 1]!)) continue;
    const rest = text.slice(i + 1);
    for (const hit of labels) {
      if (rest.toLowerCase().startsWith(hit.label.toLowerCase())) {
        const after = rest[hit.label.length];
        if (isMentionBoundary(after)) {
          found.add(hit.id);
          break;
        }
      }
    }
  }

  return [...found];
}
