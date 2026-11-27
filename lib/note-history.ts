import type { NoteEntry } from "@/lib/types";

/**
 * Deterministic 53-bit string hash (cyrb53) → base36. Same result in the
 * browser, on the server and in node tests — used for derived note ids.
 */
function hashString(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Stable id for a note entry that was stored without one:
 * hash of author + date + text (exactly as stored). Old notes are never
 * rewritten to get an id — the same entry always derives the same id.
 */
export function deriveNoteEntryId(entry: {
  author: string;
  date: string;
  text: string;
}): string {
  return `n${hashString(`${entry.author}\u0000${entry.date}\u0000${entry.text}`)}`;
}

function cleanStoredId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t && t.length <= 80 ? t : undefined;
}

/** Parse `internal_note` / `specs.production_notes` / `specs.designer_notes` JSON history (or legacy plain text). */
export function parseNoteHistory(raw: string | null | undefined): NoteEntry[] {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry): NoteEntry | null => {
          if (!entry || typeof entry !== "object") return null;
          const text =
            typeof (entry as { text?: unknown }).text === "string"
              ? (entry as { text: string }).text.trim()
              : "";
          if (!text) return null;
          const author =
            typeof (entry as { author?: unknown }).author === "string" &&
            (entry as { author: string }).author.trim()
              ? (entry as { author: string }).author.trim()
              : "Unknown";
          const storedDate =
            typeof (entry as { date?: unknown }).date === "string" &&
            (entry as { date: string }).date.trim()
              ? (entry as { date: string }).date.trim()
              : "";
          const storedId = cleanStoredId((entry as { id?: unknown }).id);
          if (storedDate) {
            return storedId
              ? { author, date: storedDate, text, id: storedId }
              : { author, date: storedDate, text };
          }
          // No stored date → the display date is "now" and would change on
          // every read, so pin a stable id from what IS stored.
          return {
            author,
            date: new Date().toISOString(),
            text,
            id: storedId ?? deriveNoteEntryId({ author, date: "", text }),
          };
        })
        .filter((e): e is NoteEntry => e != null);
    }
  } catch {
    /* legacy plain text */
  }
  return [
    {
      author: "Unknown",
      date: new Date().toISOString(),
      text: trimmed,
      id: deriveNoteEntryId({ author: "Unknown", date: "", text: trimmed }),
    },
  ];
}

export type NoteEntryWithId = NoteEntry & { id: string };

/**
 * Give every entry an id: the stored one, else derived from author+date+text.
 * Exact duplicates (same author, date and text) get `~2`, `~3`… in order.
 */
export function noteEntriesWithIds(entries: NoteEntry[]): NoteEntryWithId[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const base = entry.id ?? deriveNoteEntryId(entry);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...entry, id: n === 1 ? base : `${base}~${n}` };
  });
}

/** Parse + ids in one step. */
export function parseNoteHistoryWithIds(
  raw: string | null | undefined
): NoteEntryWithId[] {
  return noteEntriesWithIds(parseNoteHistory(raw));
}

export function serializeNoteHistory(entries: NoteEntry[]): string | null {
  if (entries.length === 0) return null;
  return JSON.stringify(entries);
}

/** Entries present in `nextRaw` that were not in `prevRaw` (append-only history). */
export function appendedNoteEntries(
  prevRaw: string | null | undefined,
  nextRaw: string | null | undefined
): NoteEntry[] {
  const prev = parseNoteHistory(prevRaw);
  const next = parseNoteHistory(nextRaw);
  if (next.length <= prev.length) return [];
  return next.slice(prev.length);
}

export function appendNoteEntry(
  history: NoteEntry[],
  text: string,
  author: string,
  date = new Date().toISOString()
): NoteEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return history;
  return [
    ...history,
    {
      author: author.trim() || "Unknown",
      date,
      text: trimmed,
    },
  ];
}

/** Plain text for PDFs / exports (entries separated by blank lines). */
export function formatNoteHistoryText(raw: string | null | undefined): string {
  return parseNoteHistory(raw)
    .map((e) => e.text)
    .filter(Boolean)
    .join("\n\n");
}

/** Wrap a first note into history JSON for create/webhook paths. */
export function noteHistoryFromPlainText(
  text: string | null | undefined,
  author: string
): string | null {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return null;
  return serializeNoteHistory(
    appendNoteEntry([], trimmed, author)
  );
}

function normalizeNoteCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Upsert the CRM-authored seed in a note history thread.
 * Empty incoming does not clear staff (or existing CRM) entries.
 * Re-syncs replace only the CRM seed — never staff-authored entries.
 */
export function upsertCrmSeedNote(
  existingRaw: string | null | undefined,
  incoming: string | null | undefined,
  author = "CRM"
): string | null {
  const history = parseNoteHistory(existingRaw);
  const historyIds = noteEntriesWithIds(history);
  const incomingTrim = incoming?.trim() ?? "";
  if (!incomingTrim) {
    return serializeNoteHistory(history);
  }
  const incomingNorm = normalizeNoteCompare(incomingTrim);
  const authorNorm = author.trim().toLowerCase() || "crm";
  const crmIdx = history.findIndex(
    (entry) => entry.author.trim().toLowerCase() === authorNorm
  );
  if (crmIdx >= 0) {
    const current = history[crmIdx]!;
    if (normalizeNoteCompare(current.text) === incomingNorm) {
      return serializeNoteHistory(history);
    }
    const next = [...history];
    next[crmIdx] = {
      ...current,
      // Pin the entry's current id before its text/date change, so a note an
      // admin hid stays hidden (and is not re-added) after a CRM re-sync.
      id: historyIds[crmIdx]!.id,
      text: incomingTrim,
      date: new Date().toISOString(),
    };
    return serializeNoteHistory(next);
  }
  const already = history.some(
    (entry) => normalizeNoteCompare(entry.text) === incomingNorm
  );
  if (already) return serializeNoteHistory(history);
  return serializeNoteHistory(appendNoteEntry(history, incomingTrim, author));
}

/**
 * Merge CRM/webhook designer notes into ticket history (`specs.designer_notes`).
 * Upserts the CRM seed; does not duplicate or wipe staff notes.
 */
export function mergeWebhookDesignerNotes(
  existingRaw: string | null | undefined,
  incoming: string | null | undefined,
  author = "CRM"
): string | null {
  return upsertCrmSeedNote(existingRaw, incoming, author);
}

/**
 * Server guard for a PATCH that replaces a whole note history string.
 *
 * - Nothing removed/changed (normal append): `raw` = the client's string, as today.
 * - Existing entries removed or edited by a NON-admin (or a stale tab): keep
 *   every stored entry untouched and append only the client's new entries.
 * - Admin: accept the client's string, but report what was removed so the
 *   caller can write it to the activity log (nothing disappears silently).
 */
export function guardNoteHistoryPatch(
  prevRaw: string | null | undefined,
  nextRaw: string | null | undefined,
  opts: { allowEdits: boolean }
): { raw: string | null; removed: NoteEntryWithId[]; merged: boolean } {
  const prev = parseNoteHistoryWithIds(prevRaw);
  const next = parseNoteHistoryWithIds(nextRaw);
  const nextIds = new Set(next.map((e) => e.id));
  const removed = prev.filter((e) => !nextIds.has(e.id));
  const normalizedNext =
    typeof nextRaw === "string" && nextRaw.trim() ? nextRaw : null;
  if (removed.length === 0 || opts.allowEdits) {
    return { raw: normalizedNext, removed, merged: false };
  }
  const prevIds = new Set(prev.map((e) => e.id));
  const added = parseNoteHistory(nextRaw).filter(
    (_e, i) => !prevIds.has(next[i]!.id)
  );
  return {
    raw: serializeNoteHistory([...parseNoteHistory(prevRaw), ...added]),
    removed: [],
    merged: true,
  };
}
