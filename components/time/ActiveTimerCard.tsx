"use client";

import { Pause, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  entrySubjectLabel,
  formatDuration,
  durationSeconds,
  isTimerPaused,
  type TimeEntry,
} from "@/lib/time-tracking";
import { Button } from "@/components/ui/button";

interface ActiveTimerCardProps {
  entry: TimeEntry;
  /** Current tick timestamp (ms) for live elapsed */
  nowMs: number;
  highlighted?: boolean;
  compact?: boolean;
  notesEditable?: boolean;
  notesDraft?: string;
  onNotesChange?: (value: string) => void;
  onNotesBlur?: () => void;
  onStop: (id: string) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onClick?: (id: string) => void;
  stopping?: boolean;
  pausing?: boolean;
}

export function ActiveTimerCard({
  entry,
  nowMs,
  highlighted,
  compact,
  notesEditable,
  notesDraft,
  onNotesChange,
  onNotesBlur,
  onStop,
  onPause,
  onResume,
  onClick,
  stopping,
  pausing,
}: ActiveTimerCardProps) {
  const paused = isTimerPaused(entry);
  const elapsed = durationSeconds(entry.started_at, null, nowMs, {
    pausedAt: entry.paused_at ?? null,
    pausedSeconds: entry.paused_seconds ?? 0,
  });
  const subject = entrySubjectLabel(entry);
  const busy = Boolean(stopping || pausing);

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(entry.id) : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(entry.id);
              }
            }
          : undefined
      }
      className={cn(
        "rounded-md border bg-white transition-colors",
        compact ? "px-2.5 py-2" : "px-3 py-3",
        highlighted
          ? "border-blue-400 ring-2 ring-blue-100"
          : paused
            ? "border-amber-200 bg-amber-50/40"
            : "border-slate-200",
        onClick && "cursor-pointer hover:border-slate-300"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2 shrink-0">
              {paused ? (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              ) : (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </>
              )}
            </span>
            <p
              className={cn(
                "truncate font-medium text-slate-800",
                compact ? "text-xs" : "text-sm"
              )}
            >
              {subject}
            </p>
          </div>
          <p
            className={cn(
              "mt-0.5 text-slate-500",
              compact ? "text-[10px]" : "text-xs"
            )}
          >
            {paused ? "Paused · " : ""}
            {entry.activity_type}
            {entry.customer_name ? ` · ${entry.customer_name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "tabular-nums font-semibold text-slate-800",
              compact ? "text-xs" : "text-sm"
            )}
          >
            {formatDuration(elapsed)}
          </span>
          {paused ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className={cn(compact ? "h-7 w-7" : "h-8 w-8")}
              title="Resume timer"
              disabled={busy || !onResume}
              onClick={(e) => {
                e.stopPropagation();
                onResume?.(entry.id);
              }}
            >
              <Play className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className={cn(compact ? "h-7 w-7" : "h-8 w-8")}
              title="Pause timer"
              disabled={busy || !onPause}
              onClick={(e) => {
                e.stopPropagation();
                onPause?.(entry.id);
              }}
            >
              <Pause className="h-3 w-3 fill-current" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={cn(compact ? "h-7 w-7" : "h-8 w-8")}
            title="Stop timer"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onStop(entry.id);
            }}
          >
            <Square className="h-3 w-3 fill-current" />
          </Button>
        </div>
      </div>
      {notesEditable ? (
        <textarea
          value={notesDraft ?? entry.notes ?? ""}
          onChange={(e) => onNotesChange?.(e.target.value)}
          onBlur={() => onNotesBlur?.()}
          onClick={(e) => e.stopPropagation()}
          placeholder="Notes (optional)"
          rows={2}
          className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      ) : null}
    </div>
  );
}
