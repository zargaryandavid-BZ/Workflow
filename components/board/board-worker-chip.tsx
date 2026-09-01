"use client";

import { Pause, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/time-tracking";

/**
 * Live timer on a card (someone else's session). Running → green; paused → muted.
 * Admins get pause/resume + stop. Shows who is working so
 * Start is not needed on this card at the same time.
 */
export function BoardWorkerChip({
  workerName,
  running,
  elapsedSeconds,
  canControl,
  busy,
  onPause,
  onResume,
  onStop,
}: {
  workerName: string;
  running: boolean;
  elapsedSeconds: number;
  canControl: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const name = workerName.trim();
  return (
    <div className="mb-1.5 max-w-full" onClick={stop} onPointerDown={stop}>
      <div
        className={cn(
          "inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          running ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
        )}
        title={
          running
            ? name
              ? `${name} is working this card`
              : "Someone is working this card"
            : name
              ? `${name} paused on this card`
              : "Someone paused on this card"
        }
      >
        <span className="relative flex h-2 w-2">
          {running ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </>
          ) : (
            <span className="inline-flex h-2 w-2 rounded-full bg-slate-400" />
          )}
        </span>
        {name ? (
          <span className="max-w-[7rem] truncate">{name}</span>
        ) : null}
        <span className="tabular-nums">{formatDuration(elapsedSeconds)}</span>
        {!running ? <span className="font-medium">· paused</span> : null}

        {canControl ? (
          <>
            {running ? (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  stop(e);
                  onPause();
                }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-700 disabled:opacity-40"
                title="Pause their timer"
              >
                <Pause className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  stop(e);
                  onResume();
                }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-slate-200 disabled:opacity-40"
                title="Resume their timer"
              >
                <Play className="h-3 w-3 fill-current" />
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                stop(e);
                onStop();
              }}
              className={cn(
                "rounded-full p-0.5 disabled:opacity-40",
                running ? "hover:bg-emerald-700" : "hover:bg-slate-200"
              )}
              title="Stop their timer"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
