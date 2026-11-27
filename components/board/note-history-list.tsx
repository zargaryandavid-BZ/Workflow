"use client";

import { EyeOff, Factory } from "lucide-react";
import type { NoteEntryWithId } from "@/lib/note-history";
import {
  noteFlagKey,
  type NoteFlagAction,
  type NoteFlags,
  type NoteThread,
} from "@/lib/note-visibility";
import { cn } from "@/lib/utils";

/** Admin note controls passed down from the card modal. */
export interface NoteFlagControls {
  flags: NoteFlags;
  /** Admin + the note_flags column exists. */
  canManage: boolean;
  /** Key of the flag currently being saved (`thread:id`). */
  busyKey?: string | null;
  onAction: (thread: NoteThread, noteId: string, action: NoteFlagAction) => void;
}

function formatNoteDate(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One note history (internal / production / designer) on the card.
 * Same look as before; admins get two small per-note buttons:
 * Hide (moves it to "Hidden notes") and For production (internal/designer only).
 */
export function NoteHistoryList({
  entries,
  thread,
  controls,
  hrClassName,
  metaClassName,
  textClassName,
}: {
  entries: NoteEntryWithId[];
  thread: NoteThread;
  controls?: NoteFlagControls;
  hrClassName: string;
  metaClassName: string;
  textClassName: string;
}) {
  if (entries.length === 0) return null;
  const production = new Set(controls?.flags.production ?? []);
  return (
    <div className="min-w-0 space-y-2">
      {entries.map((entry, i) => {
        const key = noteFlagKey(thread, entry.id);
        const markedForProduction =
          thread !== "production" && production.has(key);
        const busy = controls?.busyKey === key;
        return (
          <div key={entry.id} className="group/note min-w-0">
            {i > 0 && <hr className={cn("mb-2", hrClassName)} />}
            <div className="mb-1 flex items-start gap-2">
              <p className={cn("min-w-0 flex-1 text-[11px] font-semibold", metaClassName)}>
                {entry.author}
                <span className="mx-1 font-normal">/</span>
                {formatNoteDate(entry.date)}
                {markedForProduction ? (
                  <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-px text-[10px] font-semibold text-blue-700">
                    <Factory className="h-3 w-3" aria-hidden />
                    For production
                  </span>
                ) : null}
              </p>
              {controls?.canManage ? (
                <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover/note:opacity-100">
                  {thread !== "production" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        controls.onAction(
                          thread,
                          entry.id,
                          markedForProduction ? "unmark_production" : "mark_production"
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium hover:bg-white/80 disabled:opacity-40",
                        markedForProduction ? "text-blue-700" : "text-slate-500"
                      )}
                      title={
                        markedForProduction
                          ? "Stop showing this note to the production floor"
                          : "Also show this note to the production floor"
                      }
                    >
                      <Factory className="h-3 w-3" aria-hidden />
                      {markedForProduction ? "Unmark" : "For production"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => controls.onAction(thread, entry.id, "hide")}
                    className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-white/80 hover:text-slate-800 disabled:opacity-40"
                    title="Hide this note (admins can still see it under Hidden notes)"
                  >
                    <EyeOff className="h-3 w-3" aria-hidden />
                    Hide
                  </button>
                </div>
              ) : null}
            </div>
            <p className={cn("min-w-0 whitespace-pre-wrap text-sm", textClassName)}>
              {entry.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Admin-only "Hidden notes" section: every hidden note from all three
 * histories, with Unhide. Nothing is ever deleted.
 */
export function HiddenNotesPanel({
  groups,
  controls,
}: {
  groups: { thread: NoteThread; label: string; entries: NoteEntryWithId[] }[];
  controls: NoteFlagControls;
}) {
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  if (total === 0) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500">
        <EyeOff className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
        Hidden notes ({total}) · admins only
      </summary>
      <div className="mt-3 space-y-4">
        {groups
          .filter((g) => g.entries.length > 0)
          .map((g) => (
            <div key={g.thread} className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {g.label}
              </p>
              {g.entries.map((entry) => {
                const key = noteFlagKey(g.thread, entry.id);
                return (
                  <div
                    key={entry.id}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5"
                  >
                    <div className="mb-1 flex items-start gap-2">
                      <p className="min-w-0 flex-1 text-[11px] font-semibold text-slate-500">
                        {entry.author}
                        <span className="mx-1 font-normal">/</span>
                        {formatNoteDate(entry.date)}
                      </p>
                      <button
                        type="button"
                        disabled={controls.busyKey === key}
                        onClick={() =>
                          controls.onAction(g.thread, entry.id, "unhide")
                        }
                        className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Unhide
                      </button>
                    </div>
                    <p className="min-w-0 break-words whitespace-pre-wrap text-sm text-slate-600">
                      {entry.text}
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </details>
  );
}
