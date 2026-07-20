"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ColumnMember } from "./page";
import type { BoardColumn } from "@/lib/types";

interface Props {
  columns: BoardColumn[];
  members: ColumnMember[];
  onColumnUpdated: (column: BoardColumn) => void;
}

function staffMembers(members: ColumnMember[]): ColumnMember[] {
  return members
    .filter((m) => m.role !== "admin")
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isCellChecked(col: BoardColumn, userId: string): boolean {
  const mode = col.visibility_mode ?? "all";
  if (mode === "all") return true;
  if (mode === "roles") return false;
  return (col.visibility_users_v2 ?? []).includes(userId);
}

function isCellDisabled(col: BoardColumn): boolean {
  return (col.visibility_mode ?? "all") === "roles";
}

export function StaffVisibilityMatrix({
  columns,
  members,
  onColumnUpdated,
}: Props) {
  const staff = useMemo(() => staffMembers(members), [members]);
  const staffIds = useMemo(() => staff.map((m) => m.user_id), [staff]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function persist(
    col: BoardColumn,
    userId: string,
    visibilityMode: "all" | "individuals",
    visibilityUsersV2: string[]
  ) {
    const key = `${col.id}:${userId}`;
    setPendingKey(key);
    setError(null);

    // Optimistic update
    onColumnUpdated({
      ...col,
      visibility_mode: visibilityMode,
      visibility_users_v2: visibilityUsersV2,
    });

    const res = await fetch(`/api/columns/${col.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visibilityMode,
        visibilityUsersV2,
        visibilityRoles:
          visibilityMode === "individuals" ? col.visibility_roles ?? [] : [],
      }),
    });

    setPendingKey(null);
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Failed to update visibility");
      onColumnUpdated(col);
      return;
    }
    const json = (await res.json()) as { column: BoardColumn };
    onColumnUpdated(json.column);
  }

  async function toggle(col: BoardColumn, userId: string) {
    if (isCellDisabled(col) || pendingKey) return;

    const mode = col.visibility_mode ?? "all";
    const checked = isCellChecked(col, userId);

    if (mode === "all") {
      // Unchecking someone under "everyone" → restrict to individuals except them
      if (!checked) return;
      const next = staffIds.filter((id) => id !== userId);
      await persist(col, userId, "individuals", next);
      return;
    }

    // individuals
    const current = col.visibility_users_v2 ?? [];
    if (checked) {
      const next = current.filter((id) => id !== userId);
      await persist(col, userId, "individuals", next);
      return;
    }

    const next = [...new Set([...current, userId])];
    // If every staff member is selected, treat as open to all
    if (
      staffIds.length > 0 &&
      staffIds.every((id) => next.includes(id))
    ) {
      await persist(col, userId, "all", []);
      return;
    }
    await persist(col, userId, "individuals", next);
  }

  if (columns.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
        Add columns first, then set who can see each one.
      </p>
    );
  }

  if (staff.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
        No non-admin team members yet. Invite staff, then use this matrix to
        control column visibility.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Rows are people, columns are stages. Checked means that person can see
        the stage. Admins always see every column. Role-based columns are locked
        here — edit them in the Columns tab.
      </p>

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2.5 font-semibold text-slate-600">
                Person
              </th>
              {columns.map((col) => {
                const mode = col.visibility_mode ?? "all";
                return (
                  <th
                    key={col.id}
                    className="min-w-[5.5rem] max-w-[7rem] px-2 py-2.5 text-center font-semibold text-slate-700"
                    title={col.name}
                  >
                    <span className="line-clamp-2 leading-snug">{col.name}</span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[10px] font-normal",
                        mode === "all"
                          ? "text-emerald-600"
                          : mode === "roles"
                            ? "text-violet-600"
                            : "text-slate-400"
                      )}
                    >
                      {mode === "all"
                        ? "All"
                        : mode === "roles"
                          ? "Roles"
                          : "Staff"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {staff.map((person) => (
              <tr
                key={person.user_id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-slate-800 shadow-[1px_0_0_0_rgb(226_232_240)]">
                  <span className="block truncate">{person.name}</span>
                  <span className="text-[10px] font-normal capitalize text-slate-400">
                    {person.role.replace(/_/g, " ")}
                  </span>
                </td>
                {columns.map((col) => {
                  const disabled = isCellDisabled(col);
                  const checked = isCellChecked(col, person.user_id);
                  const busy = pendingKey === `${col.id}:${person.user_id}`;
                  return (
                    <td key={col.id} className="px-2 py-1.5 text-center">
                      <label
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-md",
                          disabled
                            ? "cursor-not-allowed opacity-40"
                            : "cursor-pointer hover:bg-slate-50",
                          busy ? "opacity-60" : ""
                        )}
                        title={
                          disabled
                            ? "This column uses role visibility — edit in Columns tab"
                            : checked
                              ? `Hide ${col.name} from ${person.name}`
                              : `Show ${col.name} to ${person.name}`
                        }
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                        ) : (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-[var(--primary)] focus:ring-[var(--primary)]"
                            checked={checked}
                            disabled={disabled || !!pendingKey}
                            onChange={() => void toggle(col, person.user_id)}
                          />
                        )}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
