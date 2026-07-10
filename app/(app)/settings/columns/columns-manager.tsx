"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  ArrowDown,
  ArrowUp,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BOARD_ROLES, ROLE_ABBR, ROLE_LABELS } from "@/lib/constants";
import { effectiveDropRoles, parseDropRoles } from "@/lib/columns";
import { RoleOrIndividualPicker, type PickerValue, type TeamMember } from "@/components/RoleOrIndividualPicker";
import type { ColumnMember } from "./page";
import type { BoardColumn, ColumnKind, Role } from "@/lib/types";

const KINDS: { value: ColumnKind; label: string; hint: string }[] = [
  { value: "normal", label: "Normal", hint: "Standard pipeline stage" },
  { value: "exception", label: "Exception", hint: "Roadblocks / returns" },
  {
    value: "approval",
    label: "Approval",
    hint: "Auto-requests customer sign-off on entry",
  },
  { value: "done", label: "Done", hint: "Ready for production" },
  {
    value: "ready_to_ship",
    label: "Ready to Ship",
    hint: "Triggers a delivery-ready notification popup",
  },
];

const KIND_BADGE: Record<ColumnKind, string> = {
  normal: "bg-slate-100 text-slate-600",
  exception: "bg-amber-100 text-amber-700",
  approval: "bg-violet-100 text-violet-700",
  done: "bg-emerald-100 text-emerald-700",
  ready_to_ship: "bg-emerald-100 text-emerald-700",
};

function kindMeta(kind: ColumnKind) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[0];
}

function dropRolesShort(roles: Role[] | null | undefined): string {
  const effective = effectiveDropRoles(parseDropRoles(roles));
  if (effective == null) return "All";
  if (effective.length === 0) return "Admins only";
  return effective.map((r) => ROLE_ABBR[r]).join(", ");
}

function visibilityShort(col: BoardColumn): string {
  const mode = col.visibility_mode ?? "all";
  if (mode === "all") return "All";
  if (mode === "roles") return col.visibility_roles?.map((r) => ROLE_ABBR[r as Role] ?? r).join(", ") || "All";
  const n = col.visibility_users_v2?.length ?? 0;
  return `${n} individual${n === 1 ? "" : "s"}`;
}

function columnConfigSummary(col: BoardColumn, index: number): string {
  const color = col.color ?? DEFAULT_COLOR;
  const picture = col.image_url ? "Picture" : "No picture";
  const vis = visibilityShort(col);
  return `#${index + 1} · ↓ ${dropRolesShort(col.drop_in_roles)} · ↑ ${dropRolesShort(col.drop_out_roles)} · 👁 ${vis} · ${color} · ${picture}`;
}

/** Convert ColumnMember (uses user_id) → TeamMember (uses id) for the picker. */
function toTeamMembers(members: ColumnMember[]): TeamMember[] {
  return members.map((m) => ({
    id: m.user_id,
    name: m.name,
    role: m.role as TeamMember["role"],
  }));
}

interface Props {
  initialColumns: BoardColumn[];
  orderCounts: Record<string, number>;
  members: ColumnMember[];
}

const DEFAULT_COLOR = "#94a3b8";

// null (unrestricted) is shown in the editor as every board role checked.
function rolesToChecked(value: Role[] | null | undefined): Role[] {
  if (value == null) return [...BOARD_ROLES];
  return BOARD_ROLES.filter((r) => value.includes(r));
}

// All checked => null (unrestricted: anyone). Otherwise the explicit list
// (which may be empty, meaning admins only).
function checkedToRoles(checked: Role[]): Role[] | null {
  if (checked.length === BOARD_ROLES.length) return null;
  return BOARD_ROLES.filter((r) => checked.includes(r));
}

export function ColumnsManager({ initialColumns, orderCounts, members }: Props) {
  const router = useRouter();
  const [columns, setColumns] = useState<BoardColumn[]>(initialColumns);
  const [editing, setEditing] = useState<BoardColumn | "new" | null>(null);
  const [deleting, setDeleting] = useState<BoardColumn | null>(null);

  useEffect(() => setColumns(initialColumns), [initialColumns]);

  async function persistOrder(next: BoardColumn[]) {
    setColumns(next);
    await fetch("/api/columns/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((c) => c.id) }),
    });
    router.refresh();
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" /> Add column
        </Button>
      </div>

      <ul className="space-y-1.5">
        {columns.map((col, index) => (
          <li
            key={col.id}
            className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <div className="flex flex-col">
              <button
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                aria-label="Move up"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                onClick={() => move(index, 1)}
                disabled={index === columns.length - 1}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30"
                aria-label="Move down"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>

            <span
              className="h-8 w-1.5 shrink-0 rounded-full"
              style={{ background: col.color ?? DEFAULT_COLOR }}
            />

            {col.image_url ? (
              <Image
                src={col.image_url}
                alt=""
                width={36}
                height={36}
                className="h-9 w-9 shrink-0 rounded-md object-cover"
                unoptimized
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-300">
                <ImageIcon className="h-4 w-4" />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-slate-800">
                  {col.name}
                </p>
                <Badge
                  className={`${KIND_BADGE[col.kind]} shrink-0`}
                  title={kindMeta(col.kind).hint}
                >
                  {kindMeta(col.kind).label}
                </Badge>
                <span className="shrink-0 text-xs text-slate-400">
                  {orderCounts[col.id] ?? 0} job
                  {(orderCounts[col.id] ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
              <p
                className="truncate text-[11px] text-slate-500"
                title={columnConfigSummary(col, index)}
              >
                {columnConfigSummary(col, index)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => setEditing(col)}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Edit column"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => setDeleting(col)}
              className="rounded p-1.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
              aria-label="Delete column"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            </div>
          </li>
        ))}
      </ul>

      {editing ? (
        <ColumnEditor
          column={editing === "new" ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteColumnDialog
          column={deleting}
          columns={columns}
          orderCount={orderCounts[deleting.id] ?? 0}
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

function ColumnEditor({
  column,
  members,
  onClose,
  onSaved,
}: {
  column: BoardColumn | null;
  members: ColumnMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const teamMembers = toTeamMembers(members);

  const [name, setName] = useState(column?.name ?? "");
  const [kind, setKind] = useState<ColumnKind>(column?.kind ?? "normal");
  const [color, setColor] = useState(column?.color ?? DEFAULT_COLOR);
  const [imageUrl, setImageUrl] = useState<string | null>(
    column?.image_url ?? null
  );
  const [dropIn, setDropIn] = useState<Role[]>(
    rolesToChecked(column?.drop_in_roles)
  );
  const [dropOut, setDropOut] = useState<Role[]>(
    rolesToChecked(column?.drop_out_roles)
  );
  const [visibility, setVisibility] = useState<PickerValue>({
    mode: column?.visibility_mode ?? "all",
    roles: column?.visibility_roles ?? [],
    userIds: column?.visibility_users_v2 ?? [],
  });
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/columns/image", {
      method: "POST",
      body: form,
    });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) {
      setError(json.error ?? "Upload failed");
      return;
    }
    setImageUrl(json.url);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const payload = {
      name,
      kind,
      color,
      imageUrl,
      dropInRoles: checkedToRoles(dropIn),
      dropOutRoles: checkedToRoles(dropOut),
      visibilityMode: visibility.mode,
      visibilityRoles: visibility.roles,
      visibilityUsersV2: visibility.userIds,
    };
    const res = await fetch(
      column ? `/api/columns/${column.id}` : "/api/columns",
      {
        method: column ? "PATCH" : "POST",
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
      title={column ? "Edit column" : "Add column"}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="column-form" disabled={loading}>
            {loading ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="column-form" onSubmit={save} className="space-y-4">
        <div>
          <Label htmlFor="col-name">Name</Label>
          <Input
            id="col-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="In Progress"
          />
        </div>
        <div>
          <Label htmlFor="col-kind">Type</Label>
          <Select
            id="col-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ColumnKind)}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label} — {k.hint}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <Label htmlFor="col-color">Color</Label>
            <input
              id="col-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded-md border border-slate-300"
            />
          </div>
          <div className="flex-1">
            <Label>Picture</Label>
            <div className="flex items-center gap-3">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-md object-cover"
                  unoptimized
                />
              ) : null}
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
                {imageUrl ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={uploadImage}
                />
              </label>
              {imageUrl ? (
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">
              Drop permissions
            </p>
            <p className="text-xs text-slate-500">
              Choose which roles can move orders. Admins can always move
              everything. Leaving every role checked means anyone can.
            </p>
          </div>
          <RolePicker
            label="↓ Drop into this stage"
            selected={dropIn}
            onChange={setDropIn}
          />
          <RolePicker
            label="↑ Take out of this stage"
            selected={dropOut}
            onChange={setDropOut}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-3 text-xs text-slate-500">
            Admins always see everything. When set to a specific role or
            individual, only matching users (plus admins) see this column.
          </p>
          <RoleOrIndividualPicker
            label="Visible to"
            value={visibility}
            members={teamMembers}
            onChange={setVisibility}
          />
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

function RolePicker({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: Role[];
  onChange: (next: Role[]) => void;
}) {
  function toggle(role: Role) {
    onChange(
      selected.includes(role)
        ? selected.filter((r) => r !== role)
        : [...selected, role]
    );
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {BOARD_ROLES.map((role) => {
          const active = selected.includes(role);
          return (
            <button
              key={role}
              type="button"
              onClick={() => toggle(role)}
              className={
                active
                  ? "rounded-md border border-blue-500 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                  : "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-50"
              }
            >
              {ROLE_LABELS[role]}
            </button>
          );
        })}
      </div>
      {selected.length === 0 ? (
        <p className="mt-1 text-xs text-amber-600">Admins only.</p>
      ) : null}
    </div>
  );
}

function DeleteColumnDialog({
  column,
  columns,
  orderCount,
  onClose,
  onDeleted,
}: {
  column: BoardColumn;
  columns: BoardColumn[];
  orderCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const others = columns.filter((c) => c.id !== column.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setError(null);
    setLoading(true);
    const url =
      orderCount > 0
        ? `/api/columns/${column.id}?moveTo=${moveTo}`
        : `/api/columns/${column.id}`;
    const res = await fetch(url, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
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
      title={`Delete "${column.name}"`}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={confirmDelete}
            disabled={loading || (orderCount > 0 && !moveTo)}
          >
            {loading ? "Deleting…" : "Delete column"}
          </Button>
        </>
      }
    >
      {orderCount > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            This column has{" "}
            <span className="font-semibold text-slate-800">
              {orderCount} job{orderCount === 1 ? "" : "s"}
            </span>
            . Choose where to move {orderCount === 1 ? "it" : "them"} before
            deleting.
          </p>
          <div>
            <Label htmlFor="move-to">Move jobs to</Label>
            <Select
              id="move-to"
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
            >
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          This column is empty. Are you sure you want to delete it?
        </p>
      )}
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
