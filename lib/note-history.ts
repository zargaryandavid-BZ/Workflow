import type { NoteEntry } from "@/lib/types";

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
          const date =
            typeof (entry as { date?: unknown }).date === "string" &&
            (entry as { date: string }).date.trim()
              ? (entry as { date: string }).date.trim()
              : new Date().toISOString();
          return { author, date, text };
        })
        .filter((e): e is NoteEntry => e != null);
    }
  } catch {
    /* legacy plain text */
  }
  return [{ author: "Unknown", date: new Date().toISOString(), text: trimmed }];
}

export function serializeNoteHistory(entries: NoteEntry[]): string | null {
  if (entries.length === 0) return null;
  return JSON.stringify(entries);
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
 * Merge CRM/webhook designer notes into ticket history (`specs.designer_notes`).
 * Skips a duplicate of text already stored.
 */
export function mergeWebhookDesignerNotes(
  existingRaw: string | null | undefined,
  incoming: string | null | undefined,
  author = "CRM"
): string | null {
  const history = parseNoteHistory(existingRaw);
  const incomingTrim = incoming?.trim() ?? "";
  if (!incomingTrim) {
    return serializeNoteHistory(history);
  }
  const incomingNorm = normalizeNoteCompare(incomingTrim);
  const already = history.some(
    (entry) => normalizeNoteCompare(entry.text) === incomingNorm
  );
  if (already) return serializeNoteHistory(history);
  return serializeNoteHistory(appendNoteEntry(history, incomingTrim, author));
}
