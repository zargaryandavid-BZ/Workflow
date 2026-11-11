"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Re-render counter that bumps whenever the element changes size (e.g. a
 * right-click menu grows when a "Move to" group is opened). Add it to a
 * "keep the menu on screen" layout effect's deps so the menu re-fits after it
 * grows, instead of only when it first opens.
 */
export function useResizeTick(
  ref: RefObject<HTMLElement | null>,
  active: boolean
): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return tick;
}
