"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
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
}

export function ImageLightbox({
  src,
  alt,
  label,
  images,
  initialIndex = 0,
  onClose,
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
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => (i + 1) % items.length);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, multi, items.length]);

  if (!current) return null;

  function goPrev(e: MouseEvent) {
    e.stopPropagation();
    setIndex((i) => (i - 1 + items.length) % items.length);
  }

  function goNext(e: MouseEvent) {
    e.stopPropagation();
    setIndex((i) => (i + 1) % items.length);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -right-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-lg hover:bg-slate-100"
          aria-label="Close preview"
        >
          <X className="h-4 w-4 text-slate-700" />
        </button>

        {multi ? (
          <button
            type="button"
            onClick={goPrev}
            className="absolute left-0 top-1/2 z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-lg hover:bg-white sm:-translate-x-14"
            aria-label="Previous picture"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}

        <img
          src={current.src}
          alt={current.alt ?? current.label ?? "Preview"}
          className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
        />

        {multi ? (
          <button
            type="button"
            onClick={goNext}
            className="absolute right-0 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-lg hover:bg-white sm:translate-x-14"
            aria-label="Next picture"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}

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
        </div>
      </div>
    </div>,
    document.body
  );
}
