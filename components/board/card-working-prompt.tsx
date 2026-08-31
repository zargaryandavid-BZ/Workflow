"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { useActiveTimer } from "@/components/time/active-timer-context";

/** Seconds a card can sit open before we ask whether they're working on it. */
const PROMPT_AFTER_SECONDS = 60;

/**
 * ~1 minute after a card is opened, if this user has no running timer on it,
 * ask "Are you working on this now?" so worked time actually gets tracked.
 * Dismissed per open; resets when a different card is opened or it's closed.
 */
export function CardWorkingPrompt({
  orderId,
  open,
}: {
  orderId: string | null;
  open: boolean;
}) {
  const activeTimer = useActiveTimer();
  const [due, setDue] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Reset the countdown whenever a different card opens (or it closes).
  useEffect(() => {
    setDue(false);
    setDismissed(false);
    if (!open || !orderId) return;
    const id = window.setTimeout(() => setDue(true), PROMPT_AFTER_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [open, orderId]);

  if (!open || !orderId || !due || dismissed) return null;
  // Already timing this card → nothing to ask.
  if (activeTimer.forOrder(orderId)) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-full border border-emerald-200 bg-white px-4 py-2.5 shadow-lg">
        <Clock className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="text-sm font-medium text-slate-700">
          Are you working on this card now?
        </span>
        <button
          type="button"
          disabled={activeTimer.busyOrderId === orderId}
          onClick={() => {
            void activeTimer.start(orderId);
            setDismissed(true);
          }}
          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Yes, start timer
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-600"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
