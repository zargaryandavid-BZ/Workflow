"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  FAST_ACTION_BUTTON_COLORS,
  FAST_ACTION_COLOR_LABELS,
  FAST_ACTION_COLOR_CLASSES,
  FAST_ACTION_DOT_CLASSES,
  isFastActionButtonColor,
} from "@/lib/fast-action-buttons";
import { RoleOrIndividualPicker, type PickerValue, type TeamMember } from "@/components/RoleOrIndividualPicker";
import { cn } from "@/lib/utils";
import type {
  BoardColumn,
  FastActionButton,
  FastActionButtonColor,
  NotificationRule,
} from "@/lib/types";

interface Props {
  initialButtons: FastActionButton[];
  columns: BoardColumn[];
  notificationRules: NotificationRule[];
  members: TeamMember[];
  disabled?: boolean;
}

export function FastActionButtonsManager({
  initialButtons,
  columns,
  notificationRules,
  members,
  disabled = false,
}: Props) {
  const router = useRouter();
  const [buttons, setButtons] = useState(initialButtons);
  const [editing, setEditing] = useState<FastActionButton | "new" | null>(null);
  const [deleting, setDeleting] = useState<FastActionButton | null>(null);

  useEffect(() => setButtons(initialButtons), [initialButtons]);

  async function toggleEnabled(btn: FastActionButton) {
    await fetch(`/api/fast-action-buttons/${btn.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !btn.enabled }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")} disabled={disabled}>
          <Plus className="h-4 w-4" /> Add Button
        </Button>
      </div>

      {buttons.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          No fast action buttons yet. Add one to give your team one-click
          shortcuts inside order cards.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {buttons.map((btn) => (
            <ButtonRow
              key={btn.id}
              button={btn}
              columns={columns}
              onEdit={() => setEditing(btn)}
              onDelete={() => setDeleting(btn)}
              onToggle={() => toggleEnabled(btn)}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <ButtonEditor
          button={editing === "new" ? null : editing}
          columns={columns}
          notificationRules={notificationRules}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteButtonDialog
          button={deleting}
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

function visibilityLabel(btn: FastActionButton): string {
  const mode = btn.visibility_mode ?? "all";
  if (mode === "all") return "All roles";
  if (mode === "roles") {
    if (!btn.visibility_roles?.length) return "All roles";
    return btn.visibility_roles.join(", ");
  }
  if (mode === "individuals") {
    const n = btn.visibility_users?.length ?? 0;
    return `${n} individual${n === 1 ? "" : "s"}`;
  }
  return "All roles";
}

function ButtonRow({
  button,
  columns,
  onEdit,
  onDelete,
  onToggle,
}: {
  button: FastActionButton;
  columns: BoardColumn[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const color = isFastActionButtonColor(button.color) ? button.color : "blue";
  const destName =
    columns.find((c) => c.id === button.destination_column_id)?.name ??
    "No column set";

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5",
        !button.enabled && "opacity-60"
      )}
    >
      <span
        className={cn(
          "h-3 w-3 shrink-0 rounded-full",
          FAST_ACTION_DOT_CLASSES[color]
        )}
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-slate-800">{button.name}</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-600">{destName}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">{visibilityLabel(button)}</p>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={button.enabled}
          onChange={onToggle}
          className="rounded border-slate-300"
        />
        Enabled
      </label>

      <button
        type="button"
        onClick={onEdit}
        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Edit button"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
        aria-label="Delete button"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function ButtonEditor({
  button,
  columns,
  notificationRules,
  members,
  onClose,
  onSaved,
}: {
  button: FastActionButton | null;
  columns: BoardColumn[];
  notificationRules: NotificationRule[];
  members: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(button?.name ?? "");
  const [color, setColor] = useState<FastActionButtonColor>(
    isFastActionButtonColor(button?.color) ? button!.color : "blue"
  );
  const [destinationColumnId, setDestinationColumnId] = useState(
    button?.destination_column_id ?? ""
  );
  const [showInColumns, setShowInColumns] = useState<string[]>(
    button?.show_in_columns ?? []
  );
  const [visibility, setVisibility] = useState<PickerValue>({
    mode: button?.visibility_mode ?? "all",
    roles: button?.visibility_roles ?? [],
    userIds: button?.visibility_users ?? [],
  });
  const [notificationRuleId, setNotificationRuleId] = useState(
    button?.notification_rule_id ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleColumn(colId: string) {
    setShowInColumns((prev) =>
      prev.includes(colId) ? prev.filter((id) => id !== colId) : [...prev, colId]
    );
  }

  // Columns available for the "show in" list: all except the destination.
  const showInColumnOptions = columns.filter(
    (c) => c.id !== destinationColumnId
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const payload = {
      name,
      color,
      destination_column_id: destinationColumnId || null,
      show_in_columns: showInColumns,
      visibility_mode: visibility.mode,
      visibility_roles: visibility.roles,
      visibility_users: visibility.userIds,
      notification_rule_id: notificationRuleId || null,
    };

    const res = await fetch(
      button
        ? `/api/fast-action-buttons/${button.id}`
        : "/api/fast-action-buttons",
      {
        method: button ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(json.error ?? "Failed to save");
      return;
    }
    onSaved();
  }

  const allColumnsChecked = showInColumns.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={button ? "Edit Fast Action Button" : "Add Fast Action Button"}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="fast-action-button-form" disabled={saving}>
            {saving ? "Saving…" : "Save Button"}
          </Button>
        </>
      }
    >
      <form id="fast-action-button-form" onSubmit={save} className="space-y-5">
        {/* Name */}
        <div>
          <Label htmlFor="fab-name">Button name</Label>
          <Input
            id="fab-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Send to Design"'
          />
        </div>

        {/* Color */}
        <div>
          <Label>Color</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {FAST_ACTION_BUTTON_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-all",
                  FAST_ACTION_COLOR_CLASSES[c],
                  color === c
                    ? "ring-2 ring-offset-1 ring-slate-400"
                    : "opacity-70 hover:opacity-100"
                )}
              >
                {FAST_ACTION_COLOR_LABELS[c]}
              </button>
            ))}
          </div>
        </div>

        {/* Destination column */}
        <div>
          <Label htmlFor="fab-dest">Move card to</Label>
          <Select
            id="fab-dest"
            required
            value={destinationColumnId}
            onChange={(e) => {
              const newDest = e.target.value;
              setDestinationColumnId(newDest);
              setShowInColumns((prev) => prev.filter((id) => id !== newDest));
            }}
          >
            <option value="">Select destination column…</option>
            {columns.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Show in columns */}
        <div>
          <Label>Show button when card is in</Label>
          <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1">
            <label className="flex items-center gap-2 px-1 py-0.5 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allColumnsChecked}
                onChange={() => setShowInColumns([])}
                className="rounded border-slate-300"
              />
              All columns (default)
            </label>
            <div className="border-t border-slate-100 pt-1">
              {showInColumnOptions.map((col) => (
                <label
                  key={col.id}
                  className="flex items-center gap-2 px-1 py-0.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 rounded"
                >
                  <input
                    type="checkbox"
                    checked={showInColumns.includes(col.id)}
                    onChange={() => toggleColumn(col.id)}
                    className="rounded border-slate-300"
                  />
                  {col.name}
                </label>
              ))}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            The destination column is auto-excluded.
          </p>
        </div>

        {/* Visible to */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <RoleOrIndividualPicker
            label="Visible to"
            value={visibility}
            members={members}
            onChange={setVisibility}
          />
        </div>

        {/* Notification rule */}
        <div>
          <Label htmlFor="fab-notif">Fire notification on click (optional)</Label>
          <Select
            id="fab-notif"
            value={notificationRuleId}
            onChange={(e) => setNotificationRuleId(e.target.value)}
          >
            <option value="">None (no notification)</option>
            {notificationRules
              .filter((r) => r.enabled)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </Select>
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

function DeleteButtonDialog({
  button,
  onClose,
  onDeleted,
}: {
  button: FastActionButton;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    const res = await fetch(`/api/fast-action-buttons/${button.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to delete");
      return;
    }
    onDeleted();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete button?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700"
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Remove <strong>{button.name}</strong>? This cannot be undone.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      ) : null}
    </Modal>
  );
}
