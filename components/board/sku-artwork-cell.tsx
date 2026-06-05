"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import type { Asset } from "@/lib/types";

interface SkuArtworkCellProps {
  skuKey: string;
  orderId?: string;
  asset: Asset | null;
  pendingFile?: File | null;
  onPendingFile?: (file: File | null) => void;
  /** When true, files stay local until the parent saves the order. */
  deferUpload?: boolean;
  /** Saved asset marked for deletion on save. */
  markedForRemoval?: boolean;
  onMarkForRemoval?: (assetId: string) => void;
  onUnmarkForRemoval?: (assetId: string) => void;
  disabled?: boolean;
}

function isImageThumbnail(name: string, mimeType?: string | null): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "svg"].includes(ext)) return true;
  const m = mimeType?.toLowerCase();
  return m === "image/png" || m === "image/jpeg" || m === "image/svg+xml";
}

function truncateFileName(name: string, max = 10): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const base = dot > 0 ? name.slice(0, dot) : name;
  const keep = max - ext.length - 1;
  if (keep <= 0) return `${name.slice(0, max - 1)}…`;
  return `${base.slice(0, keep)}…${ext}`;
}

export function SkuArtworkCell({
  skuKey: _skuKey,
  orderId,
  asset,
  pendingFile,
  onPendingFile,
  deferUpload = false,
  markedForRemoval = false,
  onMarkForRemoval,
  onUnmarkForRemoval,
  disabled = false,
}: SkuArtworkCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [stagedName, setStagedName] = useState<string | null>(null);
  const [stagedMime, setStagedMime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageOnly = deferUpload || !orderId;
  const savedAsset = asset && !markedForRemoval ? asset : null;

  function revokePreview() {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
      localPreviewRef.current = null;
      setLocalPreviewUrl(null);
    }
  }

  function setPreviewFromFile(file: File) {
    revokePreview();
    const url = URL.createObjectURL(file);
    localPreviewRef.current = url;
    setLocalPreviewUrl(url);
    setStagedName(file.name);
    setStagedMime(file.type);
  }

  function clearStaged() {
    revokePreview();
    setStagedName(null);
    setStagedMime(null);
  }

  useEffect(() => {
    if (pendingFile && !savedAsset && !localPreviewRef.current) {
      setPreviewFromFile(pendingFile);
    }
  }, [pendingFile, savedAsset]);

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) {
        URL.revokeObjectURL(localPreviewRef.current);
      }
    };
  }, []);

  function selectFile(file: File) {
    setError(null);
    setPreviewFromFile(file);
    if (savedAsset) {
      onUnmarkForRemoval?.(savedAsset.id);
    }
    onPendingFile?.(file);
  }

  function remove(e?: React.MouseEvent) {
    e?.stopPropagation();
    setError(null);
    if (pendingFile || stagedName) {
      clearStaged();
      onPendingFile?.(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (savedAsset && stageOnly) {
      onMarkForRemoval?.(savedAsset.id);
      return;
    }
    clearStaged();
    onPendingFile?.(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const fileName =
    stagedName ?? savedAsset?.file_name ?? pendingFile?.name ?? null;
  const mimeType =
    stagedMime ?? savedAsset?.mime_type ?? pendingFile?.type ?? null;
  const showImage =
    fileName != null && isImageThumbnail(fileName, mimeType);
  const thumbnailSrc =
    localPreviewUrl ??
    (savedAsset && showImage ? `/api/assets/${savedAsset.id}` : null);
  const hasPendingChange = stageOnly && (pendingFile != null || markedForRemoval);

  if (fileName) {
    return (
      <div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.ai,.eps,.png,.jpg,.jpeg,.psd,.svg"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) selectFile(file);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <div className="relative inline-block" title={fileName}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="relative block h-10 w-10 overflow-hidden rounded-md border border-slate-200 bg-slate-50 disabled:opacity-50"
            aria-label={`Replace artwork: ${fileName}`}
          >
            {showImage && thumbnailSrc ? (
              <img
                src={thumbnailSrc}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-0.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="max-w-full truncate text-[7px] leading-tight text-slate-600">
                  {truncateFileName(fileName)}
                </span>
              </div>
            )}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={disabled}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-white shadow hover:bg-red-600 disabled:opacity-50"
            aria-label="Remove artwork"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
        {hasPendingChange ? (
          <p className="mt-1 text-[10px] text-amber-600">
            Uploads when order is saved
          </p>
        ) : null}
        {error ? <p className="mt-0.5 text-[10px] text-red-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.ai,.eps,.png,.jpg,.jpeg,.psd,.svg"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) selectFile(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
      >
        <Upload className="h-3.5 w-3.5" />
        Artwork
      </button>
      {error ? <p className="mt-0.5 text-[10px] text-red-600">{error}</p> : null}
    </div>
  );
}
