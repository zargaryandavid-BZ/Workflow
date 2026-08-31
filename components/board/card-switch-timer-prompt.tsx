"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useActiveTimer } from "@/components/time/active-timer-context";

/**
 * When a user opens a card while they still have a DIFFERENT job's timer
 * running, ask what to do with that active job — pause it (resume later), stop
 * it, or keep it running — so time doesn't silently pile up on the wrong job
 * while they look at another one. Shows immediately on open; dismissed per open.
 */
export function CardSwitchTimerPrompt({
  orderId,
  open,
}: {
  orderId: string | null;
  open: boolean;
}) {
  const activeTimer = useActiveTimer();
  const [dismissed, setDismissed] = useState(false);

  // Reset each time a different card opens (or it closes).
  useEffect(() => {
    setDismissed(false);
  }, [open, orderId]);

  const running = activeTimer.myActiveRunning;
  if (!open || !orderId || dismissed || !running) return null;
  // Only prompt when the running timer is on a DIFFERENT job than the one open.
  if (!running.orderId || running.orderId === orderId) return null;

  const busy = activeTimer.busyOrderId === running.orderId;
  const jobLabel = running.orderTitle?.trim() || "another job";

  return (
    <div className="fixed inset-x-0 bottom-6 z-[121] flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-full border border-amber-200 bg-white px-4 py-2.5 shadow-lg">
        <Clock className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-sm font-medium text-slate-700">
          You&rsquo;re still timing{" "}
          <span className="font-semibold">{jobLabel}</span>.
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void activeTimer.pause(running.entryId);
            setDismissed(true);
          }}
          className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          Pause it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void activeTimer.stop(running.entryId);
            setDismissed(true);
          }}
          className="rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          Stop it
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-600"
        >
          Keep running
        </button>
      </div>
    </div>
  );
}
