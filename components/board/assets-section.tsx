"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAssetFileSize, type OrderAssetRow } from "@/lib/order-assets";
import { cn } from "@/lib/utils";
import type { Asset } from "@/lib/types";

type UploadStatus = "uploading" | "done" | "error";

interface UploadItem {
  name: string;
  status: UploadStatus;
}

interface AssetsSectionProps {
  orderId: string;
  initialAssets: Asset[];
  readOnly?: boolean;
  onPreviewImage?: (asset: Asset) => void;
  onChanged?: () => void;
}

function isImageAsset(asset: Pick<Asset, "file_name" | "mime_type">): boolean {
  const ext = asset.file_name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "svg", "gif", "webp"].includes(ext)) return true;
  const m = asset.mime_type?.toLowerCase();
  return Boolean(m?.startsWith("image/"));
}

function AssetIcon({
  mimeType,
  fileName,
}: {
  mimeType: string | null;
  fileName: string;
}) {
  const m = mimeType?.toLowerCase() ?? "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (m.includes("pdf") || ext === "pdf") {
    return <FileText className="h-4 w-4 shrink-0 text-red-500" />;
  }
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return <FileImage className="h-4 w-4 shrink-0 text-blue-500" />;
  }
  if (m.includes("zip") || m.includes("compressed") || ["zip", "rar", "7z"].includes(ext)) {
    return <Archive className="h-4 w-4 shrink-0 text-amber-600" />;
  }
  return <File className="h-4 w-4 shrink-0 text-slate-400" />;
}

export function AssetsSection({
  orderId,
  initialAssets,
  readOnly = false,
  onPreviewImage,
  onChanged,
}: AssetsSectionProps) {
  const [assets, setAssets] = useState<OrderAssetRow[]>(initialAssets);
  const [uploading, setUploading] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAssets(initialAssets);
  }, [initialAssets]);

  const refreshAssets = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/assets`);
    if (!res.ok) return;
    const json = (await res.json()) as { assets: OrderAssetRow[] };
    setAssets(json.assets);
  }, [orderId]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setError(null);
      setUploading(fileArray.map((f) => ({ name: f.name, status: "uploading" })));

      const results = await Promise.allSettled(
        fileArray.map(async (file, i) => {
          const fd = new FormData();
          fd.append("file", file);

          const res = await fetch(`/api/orders/${orderId}/assets`, {
            method: "POST",
            body: fd,
          });
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            asset?: OrderAssetRow;
          };

          setUploading((prev) =>
            prev.map((u, idx) =>
              idx === i
                ? { ...u, status: res.ok ? "done" : "error" }
                : u
            )
          );

          if (!res.ok) {
            throw new Error(data.error ?? "Upload failed");
          }
          return data.asset!;
        })
      );

      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        setError(
          failed.length === fileArray.length
            ? "Upload failed. Please try again."
            : `${failed.length} of ${fileArray.length} file(s) failed to upload.`
        );
      }

      await refreshAssets();
      setUploading([]);
      onChanged?.();
    },
    [orderId, refreshAssets, onChanged]
  );

  async function handleDelete(assetId: string) {
    setError(null);
    const res = await fetch(`/api/orders/${orderId}/assets/${assetId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Could not delete file");
      return;
    }
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    onChanged?.();
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!readOnly) setDragging(true);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (readOnly || !e.dataTransfer.files.length) return;
    void uploadFiles(e.dataTransfer.files);
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Paperclip className="h-4 w-4" /> Assets
        </p>
        {!readOnly ? (
          <>
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              Upload
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
      </div>

      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "min-h-[80px] rounded-lg border-2 border-dashed p-2 transition-colors",
          dragging
            ? "border-blue-400 bg-blue-50"
            : "border-slate-200 bg-slate-50/80",
          readOnly && "pointer-events-none"
        )}
      >
        {uploading.map((u, i) => (
          <div
            key={`${u.name}-${i}`}
            className="mb-1 flex items-center gap-2 text-xs text-slate-500"
          >
            {u.status === "uploading" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : u.status === "error" ? (
              <X className="h-3.5 w-3.5 shrink-0 text-red-500" />
            ) : (
              <span className="text-emerald-600">✓</span>
            )}
            <span className="truncate">{u.name}</span>
            {u.status === "error" ? (
              <span className="ml-auto text-red-500">Failed</span>
            ) : null}
          </div>
        ))}

        {assets.length === 0 && uploading.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            {readOnly
              ? "No files yet."
              : "Drop files here or click Upload"}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {assets.map((asset) => (
              <li
                key={asset.id}
                className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/80"
              >
                <AssetIcon mimeType={asset.mime_type} fileName={asset.file_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {asset.file_name}
                  </p>
                  {asset.size ? (
                    <p className="text-xs text-slate-400">
                      {formatAssetFileSize(asset.size)}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:transition-opacity">
                  {isImageAsset(asset) && onPreviewImage ? (
                    <button
                      type="button"
                      onClick={() => onPreviewImage(asset)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      aria-label="Preview"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  ) : null}
                  <a
                    href={`/api/assets/${asset.id}`}
                    className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                    aria-label="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(asset.id)}
                      className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
