/**
 * Who sees which card note, and the admin hide / "for production" flags.
 *
 * Notes live as JSON histories (lib/note-history.ts):
 *   internal   → orders.internal_note
 *   production → orders.specs.production_notes
 *   designer   → orders.specs.designer_notes
 * Flags live in their own column `orders.note_flags` (jsonb) so CRM / website /
 * portal re-syncs (which rewrite specs + note text) never touch them:
 *   { "hidden": ["internal:n1abc", …], "production": ["internal:n2def", …] }
 * Keys are `<thread>:<entry id>`; ids come from `noteEntriesWithIds`.
 *
 * Pure — no React / Supabase imports, so it runs in node tests.
 */

import type { Role } from "./types.ts";
import { stageKey } from "./stage-groups.ts";

export const NOTE_THREADS = ["internal", "production", "designer"] as const;
export type NoteThread = (typeof NOTE_THREADS)[number];

export function isNoteThread(value: unknown): value is NoteThread {
  return (
    typeof value === "string" &&
    (NOTE_THREADS as readonly string[]).includes(value)
  );
}

export const NOTE_THREAD_LABEL: Record<NoteThread, string> = {
  internal: "Internal note",
  production: "Production note",
  designer: "Designer note",
};

export interface NoteFlags {
  hidden: string[];
  production: string[];
}

export const EMPTY_NOTE_FLAGS: NoteFlags = { hidden: [], production: [] };

export type NoteFlagAction =
  | "hide"
  | "unhide"
  | "mark_production"
  | "unmark_production";

export function isNoteFlagAction(value: unknown): value is NoteFlagAction {
  return (
    value === "hide" ||
    value === "unhide" ||
    value === "mark_production" ||
    value === "unmark_production"
  );
}

export function noteFlagKey(thread: NoteThread, id: string): string {
  return `${thread}:${id}`;
}

function cleanKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Tolerant read of `orders.note_flags` (null / missing column / junk → empty). */
export function parseNoteFlags(raw: unknown): NoteFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { hidden: [], production: [] };
  }
  const r = raw as Record<string, unknown>;
  return {
    hidden: cleanKeyList(r.hidden),
    production: cleanKeyList(r.production),
  };
}

/** Apply one admin action. Returns the same object when nothing changes. */
export function applyNoteFlagAction(
  flags: NoteFlags,
  key: string,
  action: NoteFlagAction
): NoteFlags {
  const list = action === "hide" || action === "unhide" ? "hidden" : "production";
  const add = action === "hide" || action === "mark_production";
  const has = flags[list].includes(key);
  if (add === has) return flags;
  return {
    ...flags,
    [list]: add
      ? [...flags[list], key]
      : flags[list].filter((k) => k !== key),
  };
}

/** Only admins hide / unhide / mark notes for production. */
export function canManageNoteFlags(role: Role | null | undefined): boolean {
  return role === "admin";
}

/**
 * Production-stage columns: once a card is in one of these, the production
 * floor (prepress role) sees only production notes + notes an admin marked
 * "for production". THE one place this list lives — add new floor columns here.
 */
export const PRODUCTION_NOTE_COLUMN_NAMES = [
  "Arsen",
  "Hrach",
  "Apparel",
  "Apparel In Production",
  "In Production",
  "Finishing / Converting",
  "Production Completed",
  "Apparel Prod. Completed",
  "Outsource",
] as const;

const PRODUCTION_NOTE_COLUMN_KEYS = new Set(
  PRODUCTION_NOTE_COLUMN_NAMES.map((n) => stageKey(n))
);

export function isProductionNotesColumn(
  columnName: string | null | undefined
): boolean {
  if (!columnName?.trim()) return false;
  return PRODUCTION_NOTE_COLUMN_KEYS.has(stageKey(columnName));
}

/** Roles that get the trimmed production view in production columns. */
const PRODUCTION_VIEW_ROLES: ReadonlySet<Role> = new Set<Role>(["prepress"]);

export interface NoteViewer {
  role: Role | null | undefined;
  columnName: string | null | undefined;
}

/** True when this viewer should see only production-relevant notes. */
export function isProductionNotesView(viewer: NoteViewer): boolean {
  if (!viewer.role || !PRODUCTION_VIEW_ROLES.has(viewer.role)) return false;
  return isProductionNotesColumn(viewer.columnName);
}

/**
 * Entries shown in the card's normal note lists for this viewer.
 * - Hidden entries are never shown here (admins see them in "Hidden notes").
 * - Production view: production thread in full; other threads only entries
 *   an admin marked "for production".
 */
export function visibleNoteEntries<T extends { id: string }>(
  entries: T[],
  thread: NoteThread,
  flags: NoteFlags,
  viewer: NoteViewer
): T[] {
  const hidden = new Set(flags.hidden);
  const production = new Set(flags.production);
  const restricted = isProductionNotesView(viewer);
  return entries.filter((e) => {
    const key = noteFlagKey(thread, e.id);
    if (hidden.has(key)) return false;
    if (!restricted || thread === "production") return true;
    return production.has(key);
  });
}

/** Entries an admin hid (for the admin-only "Hidden notes" section). */
export function hiddenNoteEntries<T extends { id: string }>(
  entries: T[],
  thread: NoteThread,
  flags: NoteFlags
): T[] {
  const hidden = new Set(flags.hidden);
  return entries.filter((e) => hidden.has(noteFlagKey(thread, e.id)));
}

/** Customer note (single field) — hidden in the production view. */
export function showCustomerNoteFor(viewer: NoteViewer): boolean {
  return !isProductionNotesView(viewer);
}
