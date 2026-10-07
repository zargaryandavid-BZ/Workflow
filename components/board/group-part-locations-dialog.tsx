"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Loader2, X } from "lucide-react";

interface GroupPart {
  id: string;
  title: string;
  columnName: string;
}

export function GroupPartLocationsDialog({
  orderId,
  columnId,
  groupSize,
  onClose,
}: {
  orderId: string;
  columnId: string;
  groupSize: number;
  onClose: () => void;
}) {
  const [parts, setParts] = useState<GroupPart[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/board/ready-to-ship-check?orderId=${encodeURIComponent(orderId)}&columnId=${encodeURIComponent(columnId)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          groupParts?: GroupPart[];
        };
        if (!response.ok) {
          throw new Error(data.error ?? "Could not load order items");
        }
        setParts(data.groupParts ?? []);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Could not load order items"
        );
      });
    return () => controller.abort();
  }, [columnId, orderId]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-locations-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-600" aria-hidden="true" />
            <h2
              id="group-locations-title"
              className="font-semibold text-slate-900"
            >
              Main order items ({groupSize})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 p-5">
          {!error && parts.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading order items…
            </div>
          ) : null}
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {parts.map((part) => (
            <div
              key={part.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2.5"
            >
              <span className="min-w-0 truncate font-semibold text-slate-800">
                {part.title} ({groupSize})
              </span>
              <span className="shrink-0 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
                {part.columnName}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
