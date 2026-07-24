"use client";

import { useState } from "react";
import { Archive, Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { COLUMN_ARCHIVE_MAX_ORDERS } from "@/lib/order-archive-constants";
import type { BoardColumn } from "@/lib/types";
import type { ColumnArchiveRow } from "@/app/api/archives/route";

interface Props {
  columns: BoardColumn[];
  initialArchives: ColumnArchiveRow[];
  migrationRequired: boolean;
}

function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ArchiveSettingsManager({
  columns,
  initialArchives,
  migrationRequired,
}: Props) {
  const donePreferred =
    columns.find((c) => c.kind === "done")?.id ?? columns[0]?.id ?? "";
  const [columnId, setColumnId] = useState(donePreferred);
  const [archives, setArchives] = useState(initialArchives);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/archives");
    const json = (await res.json()) as {
      archives?: ColumnArchiveRow[];
      error?: string;
    };
    if (res.ok && json.archives) setArchives(json.archives);
  }

  async function runArchive() {
    if (!columnId) return;
    setArchiving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/archives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId }),
      });
      const json = (await res.json()) as {
        error?: string;
        archive?: ColumnArchiveRow;
        skippedOverLimit?: number;
        failureCount?: number;
      };
      if (!res.ok) {
        setError(json.error ?? "Archive failed");
        await refresh();
        return;
      }
      const parts = [
        `Saved ${json.archive?.order_count ?? 0} order(s) to Supabase Storage.`,
      ];
      if (json.skippedOverLimit) {
        parts.push(
          `${json.skippedOverLimit} order(s) skipped (limit ${COLUMN_ARCHIVE_MAX_ORDERS}).`
        );
      }
      if (json.failureCount) {
        parts.push(`${json.failureCount} file(s) could not be included.`);
      }
      setMessage(parts.join(" "));
      await refresh();
    } catch {
      setError("Archive failed");
    } finally {
      setArchiving(false);
    }
  }

  async function downloadArchive(id: string, fileName: string | null) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/archives/${id}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? "column-archive.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteArchive(id: string) {
    if (!confirm("Delete this archive from Supabase Storage?")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/archives/${id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Delete failed");
        return;
      }
      setArchives((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setError("Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  if (migrationRequired) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Apply migration <code>0062_column_archives.sql</code> (
        <code>supabase db push</code>) to enable column archives.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-800">
          Archive a column
        </h2>
        <p className="text-sm text-slate-500">
          Creates a ZIP of every order in the column (data, history dates, and
          files) and stores it in Supabase. Up to {COLUMN_ARCHIVE_MAX_ORDERS}{" "}
          orders per run. Cards stay on the board.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="archive-column">Column</Label>
            <Select
              id="archive-column"
              className="mt-1.5"
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              disabled={archiving}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === "done" ? " (Finished)" : ""}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            onClick={() => void runArchive()}
            disabled={archiving || !columnId}
          >
            {archiving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            {archiving ? "Archiving…" : "Archive to Supabase"}
          </Button>
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Stored archives
        </h2>
        {archives.length === 0 ? (
          <p className="text-sm text-slate-500">No archives yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Column</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Orders</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {archives.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 font-medium text-slate-800">
                      {a.column_name}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {formatDateTime(a.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {a.order_count}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {formatBytes(a.file_size)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          a.status === "ready"
                            ? "text-emerald-700"
                            : a.status === "failed"
                              ? "text-red-600"
                              : "text-amber-700"
                        }
                      >
                        {a.status}
                      </span>
                      {a.error ? (
                        <p className="mt-0.5 max-w-[12rem] text-xs text-slate-500">
                          {a.error}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {a.status === "ready" ? (
                          <button
                            type="button"
                            title="Download"
                            disabled={busyId === a.id}
                            onClick={() =>
                              void downloadArchive(a.id, a.file_name)
                            }
                            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                          >
                            {busyId === a.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="Delete"
                          disabled={busyId === a.id}
                          onClick={() => void deleteArchive(a.id)}
                          className="rounded-md p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
