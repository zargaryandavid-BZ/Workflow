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
