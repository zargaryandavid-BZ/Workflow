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
  const meta = [
    paused ? "Paused" : null,
    entry.activity_type,
    entry.user_display_name,
    entry.customer_name,
  ]
    .filter(Boolean)
    .join(" · ");

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
        "flex items-center gap-2 rounded-md border bg-white transition-colors",
        compact ? "px-2 py-1.5" : "px-3 py-2",
        highlighted
          ? "border-blue-400 ring-2 ring-blue-100"
          : paused
            ? "border-amber-200 bg-amber-50/40"
            : "border-slate-200",
        onClick && "cursor-pointer hover:border-slate-300"
      )}
    >
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

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p
          className={cn(
            "min-w-0 shrink truncate font-medium text-slate-800",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {entry.order_id ? (
            <a
              href={`/time?tab=log&order=${encodeURIComponent(entry.order_id)}`}
              className="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {subject}
            </a>
          ) : (
            subject
          )}
        </p>
        {meta ? (
          <p
            className={cn(
              "min-w-0 truncate text-slate-500",
              compact ? "text-[10px]" : "text-xs"
            )}
          >
            {meta}
          </p>
        ) : null}
      </div>

      {notesEditable && !compact ? (
        <input
          type="text"
          value={notesDraft ?? entry.notes ?? ""}
          onChange={(e) => onNotesChange?.(e.target.value)}
          onBlur={() => onNotesBlur?.()}
          onClick={(e) => e.stopPropagation()}
          placeholder="Notes"
          className="h-7 min-w-[8rem] max-w-[14rem] flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      ) : null}

      <div className="flex shrink-0 items-center gap-1">
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
            className="h-7 w-7"
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
            className="h-7 w-7"
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
          className="h-7 w-7"
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
  );
}
