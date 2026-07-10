"use client";

import { useRef, useState, useEffect } from "react";
import { GripVertical, ImageIcon, Loader2, Plus, X } from "lucide-react";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { compressImage } from "@/lib/compress-image";
import {
  SKU_IMAGE_MAX_BYTES,
  SKU_IMAGE_RAW_MAX_BYTES,
  uploadSizeError,
} from "@/lib/order-assets";
import { MAX_SKU_IMAGES } from "@/lib/sku-images";
import type { OrderSkuImageWithUrl } from "@/lib/types";

interface SkuImageUploadProps {
  orderId: string;
  skuId: string;
  initialImages: OrderSkuImageWithUrl[];
  ensureSkuPersisted?: (skuId: string) => Promise<string | null>;
  disabled?: boolean;
}

export function SkuImageUpload({
  orderId,
  skuId,
  initialImages,
  ensureSkuPersisted,
  disabled = false,
}: SkuImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState(initialImages);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxLabel, setLightboxLabel] = useState("");

  // drag-to-reorder state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const canUpload = !disabled && images.length < MAX_SKU_IMAGES;

  const prevInitialIdsRef = useRef(initialImages.map((i) => i.id).join(","));
  useEffect(() => {
    const ids = initialImages.map((i) => i.id).join(",");
    if (ids !== prevInitialIdsRef.current) {
      prevInitialIdsRef.current = ids;
      setImages(initialImages);
    }
  }, [initialImages]);

  async function reloadImages() {
    const res = await fetch(`/api/orders/${orderId}/skus/${skuId}/images`);
    if (!res.ok) return;
    const json = (await res.json()) as { images?: OrderSkuImageWithUrl[] };
    setImages(json.images ?? []);
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files).slice(0, MAX_SKU_IMAGES - images.length);
    if (!fileArray.length) return;

    setUploading(true);
    setError(null);

    if (ensureSkuPersisted) {
      const persistError = await ensureSkuPersisted(skuId);
      if (persistError) {
        setError(persistError);
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
    }

    for (const rawFile of fileArray) {
      const rawSizeError = uploadSizeError(rawFile.size, SKU_IMAGE_RAW_MAX_BYTES);
      if (rawSizeError) { setError(rawSizeError); break; }

      const file = await compressImage(rawFile);
      const sizeError = uploadSizeError(file.size, SKU_IMAGE_MAX_BYTES);
      if (sizeError) { setError(sizeError); break; }

      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/orders/${orderId}/skus/${skuId}/images`, {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Upload failed"); break; }
    }

    await reloadImages();
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDelete(imageId: string) {
    setError(null);
    const res = await fetch(
      `/api/orders/${orderId}/skus/${skuId}/images/${imageId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Delete failed");
      return;
    }
    setImages((prev) => prev.filter((i) => i.id !== imageId));
  }

  async function saveOrder(reordered: OrderSkuImageWithUrl[]) {
    await fetch(`/api/orders/${orderId}/skus/${skuId}/images`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((i) => i.id) }),
    });
  }

  function onDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function onDragEnter(index: number) {
    setDragOver(index);
  }

  function onDragEnd() {
    const from = dragIndexRef.current;
    const to = dragOver;
    dragIndexRef.current = null;
    setDragOver(null);
    if (from === null || to === null || from === to) return;

    const reordered = [...images];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setImages(reordered);
    void saveOrder(reordered);
  }

  return (
    <div className="mt-1.5 pl-0.5">
      <div className="flex flex-wrap gap-2">
        {images.map((img, index) => (
          <div
            key={img.id}
            draggable={!disabled}
            onDragStart={() => onDragStart(index)}
            onDragEnter={() => onDragEnter(index)}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={onDragEnd}
            className={`group relative h-14 w-14 cursor-grab active:cursor-grabbing transition-opacity ${
              dragOver === index ? "opacity-50 ring-2 ring-blue-400 rounded-lg" : ""
            }`}
          >
            {img.signed_url ? (
              <button
                type="button"
                onClick={() => {
                  setLightboxSrc(img.signed_url);
                  setLightboxLabel(img.file_name);
                }}
                className="block h-14 w-14 overflow-hidden rounded-lg border border-slate-200"
                aria-label={`View ${img.file_name}`}
              >
                <img
                  src={img.signed_url}
                  alt={img.file_name}
                  className="h-full w-full object-cover"
                />
              </button>
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs text-slate-400">
                ?
              </div>
            )}

            {/* Card thumbnail badge on first image */}
            {index === 0 ? (
              <span
                className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 shadow"
                title="This image shows on the order card"
              >
                <ImageIcon className="h-2.5 w-2.5 text-white" />
              </span>
            ) : null}

            {/* Drag handle */}
            {!disabled ? (
              <span className="absolute bottom-0.5 left-0.5 hidden group-hover:flex items-center justify-center rounded bg-black/40 p-0.5">
                <GripVertical className="h-3 w-3 text-white" />
              </span>
            ) : null}

            {/* Delete button */}
            {!disabled ? (
              <button
                type="button"
                onClick={() => handleDelete(img.id)}
                className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white group-hover:flex"
                title="Remove"
                aria-label="Remove image"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </div>
        ))}

        {canUpload ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 transition-colors hover:border-blue-400 hover:text-blue-500 disabled:opacity-50"
            title={`Add image (${images.length}/${MAX_SKU_IMAGES})`}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <span className="text-[10px]">{images.length}/{MAX_SKU_IMAGES}</span>
              </>
            )}
          </button>
        ) : null}
      </div>

      {images.length > 1 && !disabled ? (
        <p className="mt-1 text-[10px] text-slate-400">
          Drag images to reorder · <ImageIcon className="inline h-2.5 w-2.5 text-blue-500" /> = shown on card
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
        }}
      />

      {error ? <p className="mt-1 text-[10px] text-red-600">{error}</p> : null}

      {lightboxSrc ? (
        <ImageLightbox
          src={lightboxSrc}
          label={lightboxLabel}
          onClose={() => setLightboxSrc(null)}
        />
      ) : null}
    </div>
  );
}
