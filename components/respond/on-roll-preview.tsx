"use client";

import { useEffect, useState } from "react";
import {
  ROLL_DIRECTION_OPTIONS,
  formatRollDirectionPreviewAngle,
  rollDirectionArtworkRotateDeg,
  type RollDirectionValue,
} from "@/lib/roll-direction";
import { loadImageViaBlob } from "@/lib/proof-download";
import { cn } from "@/lib/utils";

const ROLL_SRC = "/roll-direction/roll-mockup.png";
/** Gap between the label thumbnails on the hanging web. */
const LABEL_GAP_PX = 6;
const LABEL_COUNT = 3;

/**
 * Vertical roll-mockup.png (608×930): hanging web on the left, core top-right,
 * unwind arrow at the bottom. Percentages are of the full image box.
 */
const FACE_LEFT_PCT = 13;
const FACE_TOP_PCT = 18;
const FACE_BOTTOM_PCT = 88;
const FACE_RIGHT_PCT = 46;

const DIRECTION_TITLE: Record<RollDirectionValue, string> = {
  "1-Top": "Roll Direction 1-Top",
  "2-Bottom": "Roll Direction 2-Bottom",
  "3-Right": "Roll Direction 3-Right",
  "4-Left": "Roll Direction 4-Left",
};

/** Draw every image (already in stacking order) onto one rotated canvas. */
function paintRotatedComposite(imgs: HTMLImageElement[], deg: number): string {
  const nw = imgs[0].naturalWidth;
  const nh = imgs[0].naturalHeight;
  const rad = (deg * Math.PI) / 180;
  const turn = ((deg % 360) + 360) % 360;
  const quarter = turn === 90 || turn === 270;
  const width = quarter ? nh : nw;
  const height = quarter ? nw : nh;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return imgs[0].src;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rad);
  for (const img of imgs) {
    ctx.drawImage(img, -nw / 2, -nh / 2);
  }
  return canvas.toDataURL("image/png");
}

export function OnRollPreview({
  baseSrc,
  layers = [],
  direction,
  /** Label width in inches (used to compute aspect ratio for proper sizing). */
  labelWidthIn,
  /** Label height in inches. */
  labelHeightIn,
  className,
  /** Grid-tile mode: just the roll graphic, no title or direction picker — used
   * to show this as one more image next to the Artwork/White/Cut tiles rather
   * than a separate full-width section. */
  compact = false,
}: {
  /** Always-on base layer (the design), same as the flat proof's base. */
  baseSrc: string;
  /** Additional named layers stacked on top, in the same order/visibility the flat proof uses — e.g. skips White/Cut when those are toggled off. */
  layers?: { src: string; visible: boolean }[];
  direction: RollDirectionValue;
  labelWidthIn?: number | null;
  labelHeightIn?: number | null;
  className?: string;
  compact?: boolean;
}) {
  const [cellSrc, setCellSrc] = useState<string | null>(null);
  const [cellAspect, setCellAspect] = useState<number | null>(null);
  const [active, setActive] = useState<RollDirectionValue>(direction);
  const rotateDeg = rollDirectionArtworkRotateDeg(active);

  useEffect(() => {
    setActive(direction);
  }, [direction]);

  // Only the currently-visible layers (same rule the flat proof uses — White
  // ink and the Cut/dieline stay off unless the customer turns them on)
  // get composited onto the roll. Previously this always used the fully
  // flattened "composite" image, so a hidden White layer still bled through
  // as a green mess on the roll mockup even though it was off in the proof.
  const visibleSrcs = [baseSrc, ...layers.filter((l) => l.visible).map((l) => l.src)];
  const srcsKey = visibleSrcs.join("|");

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    const run = async () => {
      setCellSrc(null);
      try {
        const loaded = await Promise.all(
          visibleSrcs.map((s) => loadImageViaBlob(s))
        );
        if (cancelled) return;
        for (const l of loaded) {
          if (l.objectUrl) objectUrls.push(l.objectUrl);
        }
        const base = loaded[0].img;
        const turnNow = ((rotateDeg % 360) + 360) % 360;
        const quarterNow = turnNow === 90 || turnNow === 270;
        // Read the real aspect off the actual rotated image instead of
        // guessing from the order's Width/Height rows — those can be
        // missing/wrong for a given SKU, which squeezed the label to fit
        // the wrong box (object-fill hid the mismatch by force-stretching).
        setCellAspect(
          quarterNow
            ? base.naturalHeight / base.naturalWidth
            : base.naturalWidth / base.naturalHeight
        );
        setCellSrc(
          paintRotatedComposite(
            loaded.map((l) => l.img),
            rotateDeg
          )
        );
      } catch {
        // Leave cellSrc null — the "Placing label…" state stays visible.
      }
    };

    void run();
    return () => {
      cancelled = true;
      for (const u of objectUrls) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- srcsKey covers visibleSrcs' contents
  }, [srcsKey, rotateDeg]);

  // For 90° / -90° rotations, width and height swap. Used only as a
  // best-guess placeholder size before the real image loads — cellAspect
  // (measured off the actual rotated artwork) is what actually renders it,
  // so a missing/wrong Width or Height on the order can no longer squeeze
  // the label to fit the wrong box.
  const turn = ((rotateDeg % 360) + 360) % 360;
  const isQuarterTurn = turn === 90 || turn === 270;
  const rawW = labelWidthIn ?? 1;
  const rawH = labelHeightIn ?? 1;
  const rotatedW = isQuarterTurn ? rawH : rawW;
  const rotatedH = isQuarterTurn ? rawW : rawH;
  const aspect = cellAspect ?? rotatedW / rotatedH;

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3",
        compact ? "px-1 py-1" : "px-4 py-4",
        className
      )}
    >
      {!compact ? (
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {DIRECTION_TITLE[active]}{" "}
          <span className="font-bold text-slate-700">
            {formatRollDirectionPreviewAngle(rotateDeg)}
          </span>
        </p>
      ) : null}

      {/* Click a position to visualize it — preview only, doesn't change the
          order. compact mode (grid tile) shows the same buttons, just smaller. */}
      <div
        className={cn(
          "flex flex-wrap items-center justify-center gap-1.5",
          compact ? "w-full max-w-[280px]" : "w-full max-w-[680px]"
        )}
        role="group"
        aria-label="Roll direction — click to visualize"
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
                "rounded-full font-semibold transition-colors",
                compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
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
                    "ml-1 font-bold uppercase tracking-wide",
                    compact ? "text-[8px]" : "ml-1.5 text-[10px]",
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

      <div className="relative mx-auto w-full max-w-[280px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={ROLL_SRC}
          alt=""
          className="block h-auto w-full"
          draggable={false}
        />

        <div
          className="pointer-events-none absolute overflow-hidden"
          style={{
            left: `${FACE_LEFT_PCT}%`,
            top: `${FACE_TOP_PCT}%`,
            right: `${FACE_RIGHT_PCT}%`,
            bottom: `${100 - FACE_BOTTOM_PCT}%`,
          }}
        >
          {cellSrc ? (
            <div
              className="flex h-full w-full flex-col items-center justify-end"
              style={{ gap: LABEL_GAP_PX }}
            >
              {Array.from({ length: LABEL_COUNT }, (_, i) => (
                <div
                  key={i}
                  className="relative w-full shrink-0 overflow-hidden rounded-[2px]"
                  style={{
                    aspectRatio: String(aspect),
                    maxHeight: `calc((100% - ${(LABEL_COUNT - 1) * LABEL_GAP_PX}px) / ${LABEL_COUNT})`,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cellSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-contain"
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
    </div>
  );
}
