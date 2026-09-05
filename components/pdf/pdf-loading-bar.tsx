"use client";

import { useEffect, useState } from "react";

export function PdfLoadingBar({
  seconds,
}: {
  /** Elapsed seconds, shown as “Loading... Ns”. Omit to count locally. */
  seconds?: number;
}) {
  const [tick, setTick] = useState(0);
  const controlled = seconds !== undefined && Number.isFinite(seconds);

  useEffect(() => {
    if (controlled) return;
    const started = Date.now();
    const id = window.setInterval(() => {
      setTick(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [controlled]);

  const elapsed = controlled ? Math.max(0, Math.floor(seconds)) : tick;

  return (
    <div
      className="flex h-full min-h-[12rem] w-full flex-col items-center justify-center gap-3 bg-slate-50 px-4 py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-600"
        aria-hidden
      />
      <p className="max-w-sm text-base font-semibold text-slate-800">
        Great things take a little wait. Almost there.
      </p>
      <p
        className="text-lg font-semibold tabular-nums text-blue-700"
        aria-label={`Loading ${elapsed} seconds`}
      >
        Loading... {elapsed}s
      </p>
    </div>
  );
}
