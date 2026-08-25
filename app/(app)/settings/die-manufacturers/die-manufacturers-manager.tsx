"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { DieManufacturer } from "@/lib/die-manufacturers";

type Draft = {
  full_name: string;
  contact_name: string;
  email: string;
  phone: string;
};

const EMPTY: Draft = {
  full_name: "",
  contact_name: "",
  email: "",
  phone: "",
};

export function DieManufacturersManager({
  initial,
  migrationRequired,
}: {
  initial: DieManufacturer[];
  migrationRequired?: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [editingId, setEditingId] = useState<string | "new">("new");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRows(initial), [initial]);

  const isEditing = editingId !== "new";

  function startEdit(row: DieManufacturer) {
    setEditingId(row.id);
    setDraft({
      full_name: row.full_name,
      contact_name: row.contact_name ?? "",
      email: row.email,
      phone: row.phone ?? "",
    });
    setError(null);
  }

  function cancel() {
    setEditingId("new");
    setDraft(EMPTY);
    setError(null);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const isNew = editingId === "new";
      const url = isNew
        ? "/api/settings/die-manufacturers"
        : `/api/settings/die-manufacturers/${editingId}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json()) as {
        error?: string;
        manufacturer?: DieManufacturer;
      };
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      if (!json.manufacturer) throw new Error("Failed to save");
      setRows((prev) => {
        if (isNew) {
          return [...prev, json.manufacturer!].sort((a, b) =>
            a.full_name.localeCompare(b.full_name)
          );
        }
        return prev
          .map((r) => (r.id === json.manufacturer!.id ? json.manufacturer! : r))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
      });
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this die manufacturer?")) return;
    setError(null);
    const res = await fetch(`/api/settings/die-manufacturers/${id}`, {
      method: "DELETE",
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error ?? "Failed to delete");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (editingId === id) cancel();
  }

  if (migrationRequired) {
    return (
      <p className="text-sm text-red-600">
        Run migration 0085_die_manufacturers.sql in Supabase, then reload.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => void save(e)}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <p className="text-sm font-semibold text-slate-800">
          {isEditing ? "Edit manufacturer" : "Add manufacturer"}
        </p>
        <div className="flex min-w-0 items-end gap-2">
          <div className="min-w-[7rem] flex-1">
            <Label htmlFor="die-mfg-name">Company name</Label>
            <Input
              id="die-mfg-name"
              className="mt-1.5"
              value={draft.full_name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, full_name: e.target.value }))
              }
              placeholder="Company name"
              autoComplete="organization"
            />
          </div>
          <div className="min-w-[7rem] flex-1">
            <Label htmlFor="die-mfg-contact">Contact name</Label>
            <Input
              id="die-mfg-contact"
              className="mt-1.5"
              value={draft.contact_name}
              onChange={(e) =>
                setDraft((d) => ({ ...d, contact_name: e.target.value }))
              }
              placeholder="Contact name"
              autoComplete="name"
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="die-mfg-email">Email</Label>
            <Input
              id="die-mfg-email"
              className="mt-1.5"
              type="email"
              value={draft.email}
              onChange={(e) =>
                setDraft((d) => ({ ...d, email: e.target.value }))
              }
              placeholder="email@company.com"
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="die-mfg-phone">Phone</Label>
            <Input
              id="die-mfg-phone"
              className="mt-1.5"
              value={draft.phone}
              onChange={(e) =>
                setDraft((d) => ({ ...d, phone: e.target.value }))
              }
              placeholder="Phone"
            />
          </div>
          <Button
            type="submit"
            disabled={saving}
            className="shrink-0 whitespace-nowrap"
          >
            {saving ? "Saving…" : isEditing ? "Save" : "Add"}
          </Button>
          {isEditing ? (
            <Button
              type="button"
              variant="secondary"
              onClick={cancel}
              className="shrink-0"
            >
              Cancel
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          No die manufacturers yet. Add a company, contact, email, and phone
          above — Die Order will let you pick them when sending a request.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">
                  {row.full_name}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[row.contact_name, row.email, row.phone]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => startEdit(row)}
                  aria-label={`Edit ${row.full_name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => void remove(row.id)}
                  aria-label={`Delete ${row.full_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
