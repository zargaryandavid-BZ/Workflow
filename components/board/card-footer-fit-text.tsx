"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Shrinks text to fit its flex slot so footer name/tags stay readable
 * instead of truncating with an ellipsis.
 */
export function CardFooterFitText({
  children,
  className,
  minPx = 6,
}: {
  children: string;
  className?: string;
  minPx?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 0.5 && size > minPx) {
        size -= 0.25;
        el.style.fontSize = `${size}px`;
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [children, minPx]);

  return (
    <span
      ref={ref}
      className={cn(
        "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-center leading-none",
        className
      )}
    >
      {children}
    </span>
  );
}
