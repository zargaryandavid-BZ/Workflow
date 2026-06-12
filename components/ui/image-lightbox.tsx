"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ImageLightboxProps {
  src: string;
  alt?: string;
  label?: string;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, label, onClose }: ImageLightboxProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-lg hover:bg-slate-100"
          aria-label="Close preview"
        >
          <X className="h-4 w-4 text-slate-700" />
        </button>
        <img
          src={src}
          alt={alt ?? label ?? "Preview"}
          className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain shadow-2xl"
        />
        {label ? (
          <p className="mt-2 max-w-full truncate text-center text-sm text-white/70">
            {label}
          </p>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
