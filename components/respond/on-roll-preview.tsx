"use client";

import { useEffect, useState } from "react";
import {
  ROLL_DIRECTION_OPTIONS,
  rollDirectionArtworkRotateDeg,
  type RollDirectionValue,
} from "@/lib/roll-direction";
import { cn } from "@/lib/utils";

const ROLL_SRC = "/roll-direction/roll-mockup.png";
/** Gap between the label thumbnails on the roll face. */
const LABEL_GAP_PX = 6;
const LABEL_COUNT = 3;

/**
 * The roll-mockup.png was designed with these proportions.
 * Adjust if the image changes:
 *   - Face starts at 42% from the left edge of the image
 *   - Face runs to the right edge (minus a small inset)
 *   - Face occupies from ~26% top to ~90% of image height
 */
const FACE_LEFT_PCT = 42;  // % from left where the flat unwind face begins
const FACE_TOP_PCT = 20;   // % from top where the face starts
const FACE_BOTTOM_PCT = 94; // % from top where the face ends
const FACE_RIGHT_PCT = 3;  // % from right edge — adds right margin so labels sit centered

const DIRECTION_TITLE: Record<RollDirectionValue, string> = {
  "1-Top": "Roll Direction 1-Top",
  "2-Bottom": "Roll Direction 2-Bottom",
  "3-Right": "Roll Direction 3-Right",
  "4-Left": "Roll Direction 4-Left",
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
  /** Label width in inches (used to compute aspect ratio for proper sizing). */
  labelWidthIn,
  /** Label height in inches. */
  labelHeightIn,
  className,
}: {
  artworkSrc: string;
  direction: RollDirectionValue;
  labelWidthIn?: number | null;
  labelHeightIn?: number | null;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [cellSrc, setCellSrc] = useState<string | null>(null);
  const [active, setActive] = useState<RollDirectionValue>(direction);
  const [labelScale, setLabelScale] = useState(1.45);  // 0.5–2.0 — user-calibrated default
  const [hShift, setHShift] = useState(12);             // -20 to +20 (% left/right) — user-calibrated default
  const rotateDeg = rollDirectionArtworkRotateDeg(active);

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

  // Compute aspect ratio of the rotated label so we can set exact dimensions.
  // For 90° / -90° rotations, width and height swap.
  const turn = ((rotateDeg % 360) + 360) % 360;
  const isQuarterTurn = turn === 90 || turn === 270;
  const rawW = labelWidthIn ?? 1;
  const rawH = labelHeightIn ?? 1;
  const rotatedW = isQuarterTurn ? rawH : rawW;
  const rotatedH = isQuarterTurn ? rawW : rawH;
  // aspect = width / height of the rotated label
  const aspect = rotatedW / rotatedH;

  // Dynamic face box — driven by labelScale and hShift controls
  const baseFaceH = FACE_BOTTOM_PCT - FACE_TOP_PCT;
  const scaledH = baseFaceH * labelScale;
  const faceCenterV = (FACE_BOTTOM_PCT + FACE_TOP_PCT) / 2;
  const dynTop = Math.max(FACE_TOP_PCT, faceCenterV - scaledH / 2);
  const dynBottom = Math.min(FACE_BOTTOM_PCT, faceCenterV + scaledH / 2);

  const baseFaceW = 100 - FACE_LEFT_PCT - FACE_RIGHT_PCT;
  const scaledW = baseFaceW * labelScale;
  const faceCenterX = FACE_LEFT_PCT + baseFaceW / 2;
  // Clamp so labels never overflow the roll face boundaries
  const dynLeft = Math.max(FACE_LEFT_PCT, faceCenterX - scaledW / 2 - hShift);
  const dynRight = Math.max(8, 100 - (faceCenterX + scaledW / 2) + hShift);

  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-4", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {DIRECTION_TITLE[active]}
      </p>

      {/* Direction picker */}
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
              title={isOnOrder ? `${opt.label} — set on this order` : opt.label}
            >
              {opt.label}
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

      {/* Roll mockup + arrow */}
      <div className="flex w-full max-w-[680px] items-center gap-3">
        {/* Roll image with labels overlaid */}
        <div className="relative min-w-0 flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ROLL_SRC}
            alt=""
            className="block h-auto w-full"
            draggable={false}
          />

          {/* Label overlay: positioned over the flat face of the roll */}
          <div
            className="pointer-events-none absolute overflow-hidden"
            style={{
              left: `${dynLeft}%`,
              top: `${dynTop}%`,
              right: `${dynRight}%`,
              bottom: `${100 - dynBottom}%`,
            }}
          >
            {cellSrc ? (
              /*
               * Labels are sized by HEIGHT to fill the face area, with width
               * computed from the rotated aspect ratio. This eliminates the
               * vertical "gap" that appeared when labels were flex-1 (equal
               * width) and constrained by max-width in a tall container.
               *
               * Layout: row, end-aligned (labels emerge from the right where
               * the web exits the roll) with a small gap between them.
               */
              <div
                className="flex h-full items-center justify-center"
                style={{ gap: LABEL_GAP_PX }}
              >
                {Array.from({ length: LABEL_COUNT }, (_, i) => (
                  /*
                   * Each label: width = equal share of the row (85% of face),
                   * height derived from aspect ratio (capped by face height).
                   */
                  <div
                    key={i}
                    className="relative shrink-0 overflow-hidden rounded-[2px]"
                    style={{
                      width: `calc((100% - ${(LABEL_COUNT - 1) * LABEL_GAP_PX}px) / ${LABEL_COUNT})`,
                      aspectRatio: String(aspect),
                      maxHeight: "100%",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cellSrc}
                      alt=""
                      className="absolute inset-0 h-full w-full object-fill"
                      draggable={false}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="flex h-full items-center justify-center text-[11px] text-slate-400">
                Placing label…
              </p>
            )}
          </div>
        </div>

        {/* Unwind direction arrow */}
        <svg
          className="h-8 w-8 shrink-0 text-slate-700"
          viewBox="0 0 24 24"
          fill="none"
          aria-label="Unwind direction"
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
