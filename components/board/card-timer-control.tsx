"use client";

import { useState } from "react";
import { Play, Pause, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/time-tracking";
import type { OrderTimerState } from "@/components/time/active-timer-context";

/** Why a designer paused — kept here so break time can't read as work time. */
const PAUSE_REASONS = [
  { value: "jumped_job", label: "Jumped to another job" },
  { value: "break", label: "Break" },
  { value: "waiting", label: "Waiting on an answer" },
  { value: "rejection", label: "Customer rejection came in" },
  { value: "other", label: "Other" },
] as const;

interface CardTimerControlProps {
  orderId: string;
  timer: OrderTimerState | null;
  busy: boolean;
  onStart: () => void;
  onPause: (reason?: string) => void;
  onResume: () => void;
  onStop: () => void;
}

/**
 * On-card work timer. No timer → a small "Start" button. Running → a green live
 * elapsed pill (the card itself also turns green) with Pause + Stop. Pausing
 * asks the reason. Paused → Resume + Stop.
 */
export function CardTimerControl({
  timer,
  busy,
  onStart,
  onPause,
  onResume,
  onStop,
}: CardTimerControlProps) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  if (!timer) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          stop(e);
          onStart();
        }}
        onPointerDown={stop}
        className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 opacity-0 transition-opacity hover:border-emerald-300 hover:text-emerald-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
        title="Start working on this card"
      >
        <Play className="h-3 w-3 fill-current" />
        Start
      </button>
    );
  }

  const label = formatDuration(timer.elapsedSeconds);

  return (
    <div className="relative mb-1.5" onClick={stop} onPointerDown={stop}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          timer.running
            ? "bg-emerald-600 text-white"
            : "bg-amber-100 text-amber-800"
        )}
      >
        <span className="relative flex h-2 w-2">
          {timer.running ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </>
          ) : (
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
          )}
        </span>
        <span className="tabular-nums">{label}</span>
        {timer.paused ? <span className="font-medium">· paused</span> : null}

        {timer.running ? (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              stop(e);
              setReasonOpen((v) => !v);
            }}
            className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-700 disabled:opacity-40"
            title="Pause"
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
            className="ml-0.5 rounded-full p-0.5 hover:bg-amber-200 disabled:opacity-40"
            title="Resume"
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
            timer.running ? "hover:bg-emerald-700" : "hover:bg-amber-200"
          )}
          title="Finish / stop"
        >
          <Square className="h-3 w-3 fill-current" />
        </button>
      </div>

      {reasonOpen ? (
        <div className="absolute left-0 top-7 z-30 w-52 rounded-md border border-amber-200 bg-white p-2 shadow-lg">
          <p className="mb-1.5 text-[11px] font-semibold text-amber-800">
            Pausing — what happened?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PAUSE_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                disabled={busy}
                onClick={(e) => {
                  stop(e);
                  setReasonOpen(false);
                  onPause(r.value);
                }}
                className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
