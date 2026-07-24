"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TIME_CHIP_ICONS, type TimeChip } from "@/lib/time-chips";
import type { BoardColumn } from "@/lib/types";
import { TimeChipIconView } from "@/components/board/order-card-time-chips";

interface Props {
  initialChips: TimeChip[];
  columns: BoardColumn[];
}

export function TimeChipsManager({ initialChips, columns }: Props) {
  const router = useRouter();
  const [chips, setChips] = useState(initialChips);
  const [editing, setEditing] = useState<TimeChip | "new" | null>(null);
  const [deleting, setDeleting] = useState<TimeChip | null>(null);

  useEffect(() => setChips(initialChips), [initialChips]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Control which date chips appear on cards in each column. System chips
        (Created, Late, etc.) stay fixed — you only change visibility. Create
        custom chips that stamp a date whenever a card enters a chosen column.
      </p>

      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Add time chip
        </Button>
      </div>

      {chips.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          No time chips yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {chips.map((chip) => (
            <li
              key={chip.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                <TimeChipIconView icon={chip.icon} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    {chip.name}
                  </p>
                  {chip.kind === "system" ? (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      System
                    </span>
                  ) : (
                    <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                      Custom
                    </span>
                  )}
                  {!chip.enabled ? (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      Off
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-slate-500">
                  {chip.visible_all
                    ? "Visible in all columns"
                    : chip.visible_column_ids.length === 0
                      ? "Hidden in all columns"
                      : `Visible in ${chip.visible_column_ids.length} column(s)`}
                  {chip.stamp_on_column_id
                    ? ` · Stamps on enter: ${
                        columns.find((c) => c.id === chip.stamp_on_column_id)
                          ?.name ?? "—"
                      }`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(chip)}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Edit time chip"
              >
                <Pencil className="h-4 w-4" />
              </button>
              {chip.kind === "custom" ? (
                <button
                  type="button"
                  onClick={() => setDeleting(chip)}
                  className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                  aria-label="Delete time chip"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <TimeChipEditor
          chip={editing === "new" ? null : editing}
          columns={columns}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteTimeChipDialog
          chip={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function TimeChipEditor({
  chip,
  columns,
  onClose,
  onSaved,
}: {
  chip: TimeChip | null;
  columns: BoardColumn[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = chip === null;
  const isSystem = chip?.kind === "system";
  const [name, setName] = useState(chip?.name ?? "");
  const [icon, setIcon] = useState<string>(chip?.icon ?? "clock");
  const [enabled, setEnabled] = useState(chip?.enabled ?? true);
  const [visibleAll, setVisibleAll] = useState(chip?.visible_all ?? true);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    chip?.visible_column_ids ?? []
  );
  const [stampOnColumnId, setStampOnColumnId] = useState(
    chip?.stamp_on_column_id ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleColumn(id: string) {
    setVisibleColumnIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!isSystem && !name.trim()) {
      setError("Name is required");
      return;
    }
    if (!isSystem && !stampOnColumnId) {
      setError("Pick which column stamps this date on enter");
      return;
    }
    if (!visibleAll && visibleColumnIds.length === 0) {
      setError("Pick at least one visible column, or choose “All columns”");
      return;
    }
    setError(null);
    setLoading(true);

    const payload = {
      name: name.trim(),
      icon,
      enabled,
      visible_all: visibleAll,
      visible_column_ids: visibleAll ? [] : visibleColumnIds,
      stamp_on_column_id: isSystem ? undefined : stampOnColumnId || null,
    };

    const res = await fetch(
      isNew ? "/api/time-chips" : `/api/time-chips/${chip.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to save");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add time chip" : `Edit ${chip.name}`}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="time-chip-form" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="time-chip-form" onSubmit={save} className="space-y-4">
        {isSystem ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            System chip <strong>{chip?.system_key}</strong> — meaning is fixed.
            You can change icon, on/off, and which columns show it.
          </p>
        ) : (
          <div>
            <Label htmlFor="tc-name">
              Name<span className="ml-0.5 text-red-500">*</span>
            </Label>
            <Input
              id="tc-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shipped to client"
            />
          </div>
        )}

        <div>
          <Label>Icon</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TIME_CHIP_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                title={ic}
                aria-label={ic}
                onClick={() => setIcon(ic)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md border",
                  icon === ic
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <TimeChipIconView icon={ic} className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>

        {!isSystem ? (
          <div>
            <Label htmlFor="tc-stamp">
              Stamp date when card enters
              <span className="ml-0.5 text-red-500">*</span>
            </Label>
            <select
              id="tc-stamp"
              value={stampOnColumnId}
              onChange={(e) => setStampOnColumnId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select column…</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              Date updates every time the card re-enters this column.
            </p>
          </div>
        ) : null}

        <div>
          <Label>Visible when card is in</Label>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={visibleAll}
              onChange={(e) => setVisibleAll(e.target.checked)}
            />
            All columns
          </label>
          {!visibleAll ? (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded border border-slate-200 bg-white p-2">
              {columns.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={visibleColumnIds.includes(c.id)}
                    onChange={() => toggleColumn(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function DeleteTimeChipDialog({
  chip,
  onClose,
  onDeleted,
}: {
  chip: TimeChip;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    const res = await fetch(`/api/time-chips/${chip.id}`, { method: "DELETE" });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to delete");
      return;
    }
    onDeleted();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete time chip"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Delete <strong>{chip.name}</strong>? Stamped dates on orders are kept but
        the chip will no longer show.
      </p>
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
