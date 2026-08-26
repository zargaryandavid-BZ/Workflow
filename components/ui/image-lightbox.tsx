"use client";

import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { useEffect, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";

export type ImageLightboxItem = {
  src: string;
  alt?: string;
  label?: string;
};

interface ImageLightboxProps {
  /** Single-image mode (backward compatible). */
  src?: string;
  alt?: string;
  label?: string;
  /** Multi-image gallery — enables ← → navigation when length > 1. */
  images?: ImageLightboxItem[];
  initialIndex?: number;
  onClose: () => void;
  /** Pin the current picture as the Kanban card image (autosaves). */
  onShowOnCard?: (index: number) => void;
  showOnCardBusy?: boolean;
  /** Index of the picture currently pinned on the Kanban card. */
  cardImageIndex?: number;
}

/** Prevent the click that closed the overlay from falling through to the board. */
function suppressClickThrough() {
  const suppress = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener("click", suppress, true);
  document.addEventListener("mouseup", suppress, true);
  window.setTimeout(() => {
    document.removeEventListener("click", suppress, true);
    document.removeEventListener("mouseup", suppress, true);
  }, 350);
}

export function ImageLightbox({
  src,
  alt,
  label,
  images,
  initialIndex = 0,
  onClose,
  onShowOnCard,
  showOnCardBusy = false,
  cardImageIndex = 0,
}: ImageLightboxProps) {
  const items: ImageLightboxItem[] =
    images && images.length > 0
      ? images
      : src
        ? [{ src, alt, label }]
        : [];

  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1))
  );

  const current = items[index];
  const multi = items.length > 1;

  useEffect(() => {
    setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1)));
  }, [initialIndex, items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (!multi) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIndex((i) => (i + 1) % items.length);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, multi, items.length]);

  if (!current) return null;

  function closeLightbox() {
    suppressClickThrough();
    onClose();
  }

  function onBackdropPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
  }

  function goPrev(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i - 1 + items.length) % items.length);
  }

  function goNext(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + 1) % items.length);
  }

  function stop(e: MouseEvent | PointerEvent) {
    e.stopPropagation();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-4"
      onPointerDown={onBackdropPointerDown}
      onClick={(e) => {
        // Backdrop close is handled on pointerdown; block residual clicks.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={stop}
        onPointerDown={stop}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeLightbox();
          }}
          onPointerDown={stop}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-lg hover:bg-slate-100"
          aria-label="Close preview"
        >
          <X className="h-4 w-4 text-slate-700" />
        </button>

        <div className="relative">
          {multi ? (
            <button
              type="button"
              onClick={goPrev}
              onPointerDown={stop}
              className="absolute left-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-lg hover:bg-white"
              aria-label="Previous picture"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          ) : null}

          <img
            src={current.src}
            alt={current.alt ?? current.label ?? "Preview"}
            className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
            draggable={false}
          />

          {multi ? (
            <button
              type="button"
              onClick={goNext}
              onPointerDown={stop}
              className="absolute right-2 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-lg hover:bg-white"
              aria-label="Next picture"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          ) : null}
        </div>

        <div className="mt-2 flex max-w-full flex-col items-center gap-1">
          {current.label ? (
            <p className="max-w-full truncate text-center text-sm text-white/70">
              {current.label}
            </p>
          ) : null}
          {multi ? (
            <p className="text-xs font-medium tabular-nums text-white/55">
              {index + 1} / {items.length}
            </p>
          ) : null}
          {onShowOnCard ? (
            <button
              type="button"
              disabled={showOnCardBusy || index === cardImageIndex}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onShowOnCard(index);
              }}
              onPointerDown={stop}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-lg hover:bg-slate-100 disabled:cursor-default disabled:opacity-80"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              {index === cardImageIndex
                ? "Showing on order card"
                : showOnCardBusy
                  ? "Saving…"
                  : "Show this pic on the order card"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
