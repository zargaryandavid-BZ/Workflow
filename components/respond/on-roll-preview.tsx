"use client";

import { useEffect, useState } from "react";
import {
  ROLL_DIRECTION_OPTIONS,
  formatRollDirectionPreviewAngle,
  rollDirectionPreviewRotateDeg,
  type RollDirectionValue,
} from "@/lib/roll-direction";
import { cn } from "@/lib/utils";

const ROLL_SRC = "/roll-direction/roll-mockup.png";
/** Space between the roll box and the unwind arrow. */
const LABEL_TO_ARROW_PX = 20;
/** Space between artwork and the hanging web: top, bottom, and right. */
const WEB_INSET_PX = 10;
/** Space between the three labels. */
const LABEL_GAP_PX = 10;
const LABEL_COUNT = 3;

const DIRECTION_TITLE: Record<RollDirectionValue, string> = {
  "1-Top": "Roll Direction 1-Top",
  "2-Bottom": "Roll Direction 2-Bottom",
  "3-Right": "Roll Direction 3-Right",
  "4-Left": "Roll Direction 4-Left",
};

const DIR_SHORT: Record<RollDirectionValue, string> = {
  "1-Top": "1 · Top",
  "2-Bottom": "2 · Bottom",
  "3-Right": "3 · Right",
  "4-Left": "4 · Left",
};

function paintRotated(img: HTMLImageElement, deg: number): string {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const rad = (deg * Math.PI) / 180;
  const turn = ((deg % 360) + 360) % 360;
  const quarter = turn === 90 || turn === 270;
  const width = quarter ? nh : nw;
  const height = quarter ? nw : nh;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return img.src;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -nw / 2, -nh / 2);
  return canvas.toDataURL("image/png");
}

export function OnRollPreview({
  artworkSrc,
  direction,
  className,
}: {
  artworkSrc: string;
  direction: RollDirectionValue;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [cellSrc, setCellSrc] = useState<string | null>(null);
  const [active, setActive] = useState<RollDirectionValue>(direction);
  const rotateDeg = rollDirectionPreviewRotateDeg(direction, active);

  useEffect(() => {
    setActive(direction);
  }, [direction]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const run = async () => {
      if (artworkSrc.startsWith("data:") || artworkSrc.startsWith("blob:")) {
        setSrc(artworkSrc);
        return;
      }
      try {
        const res = await fetch(artworkSrc);
        if (!res.ok || cancelled) return;
        objectUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(artworkSrc);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artworkSrc]);

  useEffect(() => {
    if (!src) {
      setCellSrc(null);
      return;
    }
    const img = new Image();
    img.onload = () => setCellSrc(paintRotated(img, rotateDeg));
    img.src = src;
  }, [src, rotateDeg]);

  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-4", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {DIRECTION_TITLE[active]}
      </p>

      <div
        className="flex w-full max-w-[680px] flex-wrap items-center justify-center gap-1.5"
        role="group"
        aria-label="Roll direction"
      >
        {ROLL_DIRECTION_OPTIONS.map((opt) => {
          const isActive = opt.value === active;
          const isOnOrder = opt.value === direction;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setActive(opt.value)}
              aria-pressed={isActive}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                isActive
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                isOnOrder && !isActive && "ring-2 ring-blue-500 ring-offset-1"
              )}
              title={
                isOnOrder ? `${opt.label} — set on this order` : opt.label
              }
            >
              {isOnOrder
                ? DIR_SHORT[opt.value]
                : formatRollDirectionPreviewAngle(
                    rollDirectionPreviewRotateDeg(direction, opt.value)
                  )}
              {isOnOrder ? (
                <span
                  className={cn(
                    "ml-1.5 text-[10px] font-bold uppercase tracking-wide",
                    isActive ? "text-blue-100" : "text-blue-600"
                  )}
                >
                  Set
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        className="flex w-full max-w-[680px] items-center"
        style={{ gap: LABEL_TO_ARROW_PX }}
      >
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ROLL_SRC}
            alt=""
            className="block h-auto w-full"
            draggable={false}
          />
          {src ? (
            <div
              className="absolute box-border overflow-hidden"
              style={{
                left: "42%",
                top: "26%",
                right: WEB_INSET_PX,
                height: "70%",
                paddingTop: WEB_INSET_PX,
                paddingBottom: WEB_INSET_PX,
                paddingRight: WEB_INSET_PX,
              }}
            >
              {cellSrc ? (
                <div
                  className="flex h-full w-full items-center justify-end"
                  style={{ gap: LABEL_GAP_PX }}
                >
                  {Array.from({ length: LABEL_COUNT }, (_, i) => (
                    <div
                      key={i}
                      className="flex h-full min-w-0 flex-1 items-center justify-end"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cellSrc}
                        alt=""
                        className="max-h-full max-w-full object-contain object-right"
                        draggable={false}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-400">
                  Placing label…
                </p>
              )}
            </div>
          ) : (
            <p className="absolute inset-x-[44%] top-1/2 text-center text-[11px] text-slate-400">
              Placing label…
            </p>
          )}
        </div>
        <svg
          className="h-8 w-8 shrink-0 text-slate-800"
          style={{ transform: "translate(-10px, 10px)" }}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <path
            d="M5 12h14M12 5l7 7-7 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
