"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import {
  CONDITION_KIND_META,
  createCondition,
  fillEmptyColumnsWithSuggestions,
  formatConditionSummary,
  normalizeEmergencyBalance,
  type ColumnRef,
  type EmergencyBalanceConfig,
  type EmergencyCondition,
  type EmergencyConditionKind,
  type EmergencyConditionSeverity,
} from "@/lib/emergency-balance";
import { cn } from "@/lib/utils";
import type { BoardColumn } from "@/lib/types";

interface Props {
  columns: BoardColumn[];
  initial: EmergencyBalanceConfig;
  migrationRequired?: boolean;
}

const KIND_OPTIONS = Object.entries(CONDITION_KIND_META) as [
  EmergencyConditionKind,
  (typeof CONDITION_KIND_META)[EmergencyConditionKind],
][];

const SEVERITY_OPTIONS: { value: EmergencyConditionSeverity; label: string }[] =
  [
    { value: "amber", label: "Heads-up" },
    { value: "red", label: "Emergency" },
    { value: "critical", label: "Critical" },
    {
      value: "due_overlay",
      label: "Due-date colors (late / today / 1 day / due soon)",
    },
  ];

export function EmergencyBalanceManager({
  columns,
  initial,
  migrationRequired = false,
}: Props) {
  const router = useRouter();
  const columnRefs: ColumnRef[] = useMemo(
    () => columns.map((c) => ({ id: c.id, name: c.name })),
    [columns]
  );

  const [values, setValues] = useState<EmergencyBalanceConfig>(() =>
    normalizeEmergencyBalance(initial, columnRefs)
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    () => columns[0]?.id ?? null
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKind, setNewKind] =
    useState<EmergencyConditionKind>("idle_hours");

  const selected = columns.find((c) => c.id === selectedId) ?? null;
  const selectedConditions = selected
    ? (values.by_column[selected.id] ?? [])
    : [];

  const isDirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initial),
    [values, initial]
  );

  const save = useCallback(
    async (next: EmergencyBalanceConfig) => {
      if (migrationRequired) return;
      setSaving(true);
      setSaved(false);
      setError(null);
      const normalized = normalizeEmergencyBalance(next, columnRefs);
      const res = await fetch("/api/settings/emergency-balance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalized),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        emergency_balance?: EmergencyBalanceConfig;
      };
      setSaving(false);
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      if (data.emergency_balance) {
        setValues(normalizeEmergencyBalance(data.emergency_balance, columnRefs));
      } else {
        setValues(normalized);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    },
    [migrationRequired, router, columnRefs]
  );

  function setConditions(columnId: string, next: EmergencyCondition[]) {
    setValues((prev) => ({
      ...prev,
      by_column: { ...prev.by_column, [columnId]: next },
    }));
  }

  function updateCondition(
    columnId: string,
    conditionId: string,
    patch: Partial<EmergencyCondition>
  ) {
    const list = values.by_column[columnId] ?? [];
    setConditions(
      columnId,
      list.map((c) => (c.id === conditionId ? { ...c, ...patch } : c))
    );
  }

  function removeCondition(columnId: string, conditionId: string) {
    const list = values.by_column[columnId] ?? [];
    setConditions(
      columnId,
      list.filter((c) => c.id !== conditionId)
    );
  }

  function addCondition(columnId: string) {
    const meta = CONDITION_KIND_META[newKind];
    const cond = createCondition({
      kind: newKind,
      value: meta.needsValue ? (meta.valueUnit === "hours" ? 5 : 2) : 0,
      value2: meta.needsValue2 ? 2 : undefined,
      severity: "amber",
    });
    setConditions(columnId, [...(values.by_column[columnId] ?? []), cond]);
  }

  function clearColumn(columnId: string) {
    setConditions(columnId, []);
  }

  function applySuggestionsToEmpty() {
    setValues((prev) => fillEmptyColumnsWithSuggestions(prev, columnRefs));
  }

  function resetAllToSuggestions() {
    const next = normalizeEmergencyBalance({}, columnRefs);
    setValues(next);
    void save(next);
  }

  return (
    <div className="space-y-6">
      {migrationRequired ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Database migration required
          </p>
          <p className="mt-1 text-amber-800">
            Run{" "}
            <code className="rounded bg-amber-100 px-1">
              0072_emergency_balance.sql
            </code>{" "}
            first.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={migrationRequired || saving || !isDirty}
          onClick={() => void save(values)}
        >
          {saving ? "Saving…" : "Save balance"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={migrationRequired || saving}
          onClick={applySuggestionsToEmpty}
        >
          Fill empty columns with defaults
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={migrationRequired || saving}
          onClick={resetAllToSuggestions}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset all to defaults
        </Button>
        {saved ? (
          <span className="text-sm text-emerald-600">Saved</span>
        ) : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>

      <p className="text-sm text-slate-500">
        Select a board column on the left, then add IF → THEN conditions on the
        right. <strong className="font-medium text-slate-700">No conditions = no emergency warning</strong>{" "}
        for that column. New columns you add to the board appear here automatically.
      </p>

      {/* Global */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Board-wide
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="combo_days">Combo at risk — due within (days)</Label>
            <Input
              id="combo_days"
              type="number"
              min={1}
              max={14}
              disabled={migrationRequired || saving}
              className="mt-1 max-w-[120px]"
              value={values.combo_at_risk_due_days}
              onChange={(e) =>
                setValues((p) => ({
                  ...p,
                  combo_at_risk_due_days: Math.round(Number(e.target.value)) || 1,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="amber_tight">
              Due soon — closer window (days)
            </Label>
            <Input
              id="amber_tight"
              type="number"
              min={1}
              max={14}
              disabled={migrationRequired || saving}
              className="mt-1 max-w-[120px]"
              value={values.due_overlay_amber_tight_days}
              onChange={(e) =>
                setValues((p) => ({
                  ...p,
                  due_overlay_amber_tight_days:
                    Math.round(Number(e.target.value)) || 1,
                }))
              }
            />
            <p className="mt-1 text-xs text-slate-400">
              e.g. due in 2 days → heads-up
            </p>
          </div>
          <div>
            <Label htmlFor="amber_wide">
              Due soon — wider window (days)
            </Label>
            <Input
              id="amber_wide"
              type="number"
              min={1}
              max={30}
              disabled={migrationRequired || saving}
              className="mt-1 max-w-[120px]"
              value={values.due_overlay_amber_days}
              onChange={(e) =>
                setValues((p) => ({
                  ...p,
                  due_overlay_amber_days:
                    Math.round(Number(e.target.value)) || 1,
                }))
              }
            />
            <p className="mt-1 text-xs text-slate-400">
              e.g. due in 3 days → heads-up
            </p>
          </div>
          <label className="flex cursor-pointer items-end gap-2 pb-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={values.flag_late_always}
              disabled={migrationRequired || saving}
              onChange={(e) =>
                setValues((p) => ({
                  ...p,
                  flag_late_always: e.target.checked,
                }))
              }
            />
            Always flag past-due (any column)
          </label>
        </div>
      </section>

      {/* Column picker + conditions */}
      <div className="grid min-h-[28rem] overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[minmax(14rem,18rem)_1fr]">
        <aside className="max-h-[70vh] overflow-y-auto border-b border-slate-200 lg:border-b-0 lg:border-r">
          <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Board columns ({columns.length})
          </div>
          <ul>
            {columns.map((col) => {
              const count = values.by_column[col.id]?.length ?? 0;
              const active = col.id === selectedId;
              return (
                <li key={col.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(col.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition-colors",
                      active
                        ? "bg-blue-50 font-medium text-blue-900"
                        : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <span className="truncate">{col.name}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        count > 0
                          ? "bg-amber-100 text-amber-800"
                          : "bg-slate-100 text-slate-400"
                      )}
                    >
                      {count > 0 ? count : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="flex min-h-[20rem] flex-col p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">
              No board columns found. Add columns in Settings → Columns first.
            </p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">
                    {selected.name}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {selectedConditions.length === 0
                      ? "No conditions — this column will not show emergency warnings."
                      : `${selectedConditions.length} condition${selectedConditions.length === 1 ? "" : "s"} (evaluated in order)`}
                  </p>
                </div>
                {selectedConditions.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={migrationRequired || saving}
                    onClick={() => clearColumn(selected.id)}
                  >
                    Clear all
                  </Button>
                ) : null}
              </div>

              <ol className="mb-4 flex-1 space-y-3">
                {selectedConditions.map((cond, index) => (
                  <li
                    key={cond.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/80 p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-slate-500">
                        {index + 1}. {formatConditionSummary(cond)}
                      </p>
                      <button
                        type="button"
                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600"
                        title="Remove condition"
                        disabled={migrationRequired || saving}
                        onClick={() => removeCondition(selected.id, cond.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label>When</Label>
                        <Select
                          className="mt-1"
                          disabled={migrationRequired || saving}
                          value={cond.kind}
                          onChange={(e) => {
                            const kind = e.target
                              .value as EmergencyConditionKind;
                            const meta = CONDITION_KIND_META[kind];
                            updateCondition(selected.id, cond.id, {
                              kind,
                              value: meta.needsValue
                                ? cond.value || 1
                                : 0,
                              value2: meta.needsValue2
                                ? cond.value2 ?? 1
                                : undefined,
                            });
                          }}
                        >
                          {KIND_OPTIONS.map(([k, meta]) => (
                            <option key={k} value={k}>
                              {meta.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {CONDITION_KIND_META[cond.kind].needsValue ? (
                        <div>
                          <Label>
                            {CONDITION_KIND_META[cond.kind].valueLabel} (
                            {CONDITION_KIND_META[cond.kind].valueUnit})
                          </Label>
                          <Input
                            type="number"
                            className="mt-1 max-w-[140px]"
                            min={0}
                            max={336}
                            disabled={migrationRequired || saving}
                            value={cond.value}
                            onChange={(e) =>
                              updateCondition(selected.id, cond.id, {
                                value: Math.round(Number(e.target.value)) || 0,
                              })
                            }
                          />
                        </div>
                      ) : null}
                      {CONDITION_KIND_META[cond.kind].needsValue2 ? (
                        <div>
                          <Label>
                            {CONDITION_KIND_META[cond.kind].value2Label} (
                            {CONDITION_KIND_META[cond.kind].value2Unit})
                          </Label>
                          <Input
                            type="number"
                            className="mt-1 max-w-[140px]"
                            min={0}
                            max={336}
                            disabled={migrationRequired || saving}
                            value={cond.value2 ?? 0}
                            onChange={(e) =>
                              updateCondition(selected.id, cond.id, {
                                value2:
                                  Math.round(Number(e.target.value)) || 0,
                              })
                            }
                          />
                        </div>
                      ) : null}
                      <div>
                        <Label>Then</Label>
                        <Select
                          className="mt-1"
                          disabled={migrationRequired || saving}
                          value={cond.severity}
                          onChange={(e) =>
                            updateCondition(selected.id, cond.id, {
                              severity: e.target
                                .value as EmergencyConditionSeverity,
                            })
                          }
                        >
                          {SEVERITY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-auto flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
                <div className="min-w-[14rem] flex-1">
                  <Label>Add condition</Label>
                  <Select
                    className="mt-1"
                    disabled={migrationRequired || saving}
                    value={newKind}
                    onChange={(e) =>
                      setNewKind(e.target.value as EmergencyConditionKind)
                    }
                  >
                    {KIND_OPTIONS.map(([k, meta]) => (
                      <option key={k} value={k}>
                        {meta.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={migrationRequired || saving}
                  onClick={() => addCondition(selected.id)}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
