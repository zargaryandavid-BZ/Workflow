"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  CARD_WARNING_COLORS,
  CARD_WARNING_COLOR_LABELS,
  CARD_WARNING_COLOR_SWATCHES,
  isCardWarningColor,
} from "@/lib/card-warning-rules";
import type { BoardColumn, CardWarningColor, CardWarningRule } from "@/lib/types";

interface Props {
  initialRules: CardWarningRule[];
  columns: BoardColumn[];
  disabled?: boolean;
  initialOpacity: number;
  initialSpeedMs: number;
  initialSpreadPx: number;
}

export function CardWarningsManager({
  initialRules,
  columns,
  disabled = false,
  initialOpacity,
  initialSpeedMs,
  initialSpreadPx,
}: Props) {
  const router = useRouter();
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState<CardWarningRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<CardWarningRule | null>(null);

  // Animation settings
  const [opacity, setOpacity]   = useState(initialOpacity);
  const [speedMs, setSpeedMs]   = useState(initialSpeedMs);
  const [spreadPx, setSpreadPx] = useState(initialSpreadPx);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  const saveAnimation = useCallback(async (patch: {
    warning_opacity?: number;
    warning_speed_ms?: number;
    warning_spread_px?: number;
  }) => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/settings/warning-animation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  async function toggleEnabled(rule: CardWarningRule) {
    const res = await fetch(`/api/card-warning-rules/${rule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    });
    if (res.ok) {
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      );
      router.refresh();
    }
  }

  // Derive unique colors from the rules list (preserving order of first appearance)
  const ruleColors: CardWarningColor[] = [];
  for (const r of rules) {
    if (!ruleColors.includes(r.color)) ruleColors.push(r.color);
  }
  const defaultPreviewColor: CardWarningColor =
    ruleColors[0] ?? "amber";
  const [previewColor, setPreviewColor] = useState<CardWarningColor>(defaultPreviewColor);
  // Keep selected color valid when rules change
  const activePreviewColor = ruleColors.includes(previewColor)
    ? previewColor
    : (ruleColors[0] ?? "amber");

  const previewStyle = {
    "--w-opacity": opacity / 100,
    "--w-spread": `${spreadPx}px`,
    "--w-duration": `${speedMs / 1000}s`,
  } as React.CSSProperties;

  return (
    <div className="space-y-8">

      {/* ── Animation settings ───────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">
          Animation style
        </h2>
        <p className="mb-5 text-xs text-slate-500">
          Controls how the pulse glow looks on stale cards across the board.
          Changes are saved instantly.
        </p>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">

          {/* Live preview card */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Preview
            </p>
            <div
              style={previewStyle}
              className={`relative w-48 rounded-md border border-slate-200 bg-white p-2.5 shadow-sm warning-${activePreviewColor}`}
            >
              {/* dot badge */}
              <span className={`warning-dot-${activePreviewColor} absolute right-1.5 top-1.5 h-2 w-2 rounded-full`} />
              {/* mock card content */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 truncate">
                    <span className="text-sm font-bold text-slate-900">Jane Smith</span>
                    <span className="text-[10px] font-medium text-slate-400">· 0042</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                    <span>📅</span>
                    <span>Jun 30</span>
                    <span className="text-slate-500">· T-shirt print</span>
                  </div>
                </div>
              </div>
              <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  <span>👤</span> Alex D.
                </span>
              </div>
            </div>

            {/* Color swatches — one per rule colour */}
            {ruleColors.length > 0 ? (
              <div className="flex items-center gap-1.5 pt-0.5">
                {ruleColors.map((c) => {
                  const isActive = c === activePreviewColor;
                  const ruleName = rules.find((r) => r.color === c)?.name ?? CARD_WARNING_COLOR_LABELS[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      title={ruleName}
                      onClick={() => setPreviewColor(c)}
                      className={`h-5 w-5 rounded-full border-2 transition-transform ${
                        isActive ? "scale-125 border-slate-700" : "border-transparent hover:scale-110"
                      }`}
                      style={{ backgroundColor: CARD_WARNING_COLOR_SWATCHES[c] }}
                    />
                  );
                })}
              </div>
            ) : null}

            <p className="max-w-[12rem] text-center text-[10px] text-slate-400">
              {ruleColors.length > 0
                ? "Click a colour to preview that rule"
                : "Card stuck in a watched column"}
            </p>
          </div>

          {/* Sliders */}
          <div className="flex-1 space-y-5">

            {/* Transparency */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Transparency
                </label>
                <span className="text-sm tabular-nums text-slate-500">
                  {opacity}%
                </span>
              </div>
              <input
                type="range"
                min={5} max={100} step={5}
                value={opacity}
                disabled={disabled}
                onChange={(e) => setOpacity(Number(e.target.value))}
                onPointerUp={() => saveAnimation({ warning_opacity: opacity })}
                className="w-full accent-[var(--primary)]"
              />
              <p className="mt-0.5 text-[11px] text-slate-400">
                How visible the glow colour is (5 = barely visible, 100 = solid)
              </p>
            </div>

            {/* Speed */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Speed
                </label>
                <span className="text-sm tabular-nums text-slate-500">
                  {(speedMs / 1000).toFixed(1)} s
                </span>
              </div>
              <input
                type="range"
                min={500} max={8000} step={250}
                value={speedMs}
                disabled={disabled}
                onChange={(e) => setSpeedMs(Number(e.target.value))}
                onPointerUp={() => saveAnimation({ warning_speed_ms: speedMs })}
                className="w-full accent-[var(--primary)]"
              />
              <p className="mt-0.5 text-[11px] text-slate-400">
                One full pulse cycle — shorter = faster, longer = slower
              </p>
            </div>

            {/* Glow radius */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Glow radius
                </label>
                <span className="text-sm tabular-nums text-slate-500">
                  {spreadPx} px
                </span>
              </div>
              <input
                type="range"
                min={1} max={20} step={1}
                value={spreadPx}
                disabled={disabled}
                onChange={(e) => setSpreadPx(Number(e.target.value))}
                onPointerUp={() => saveAnimation({ warning_spread_px: spreadPx })}
                className="w-full accent-[var(--primary)]"
              />
              <p className="mt-0.5 text-[11px] text-slate-400">
                How far the glow extends beyond the card edge
              </p>
            </div>

            {saving || saved ? (
              <p className="text-[11px] text-slate-400">
                {saving ? "Saving…" : "✓ Saved"}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Warning rules list ───────────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Warning rules</h2>
          <Button
            onClick={() => setEditing("new")}
            disabled={disabled}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Warning
          </Button>
        </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 py-12 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">No warning rules yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Add one to highlight cards that have been stuck too long.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rules.map((rule) => {
            const swatch = CARD_WARNING_COLOR_SWATCHES[rule.color];
            const columnScope =
              rule.apply_to_columns.length === 0
                ? "All columns"
                : rule.apply_to_columns
                    .map(
                      (id) =>
                        columns.find((c) => c.id === id)?.name ?? "Unknown"
                    )
                    .join(", ");

            return (
              <div
                key={rule.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: swatch }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {rule.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {rule.threshold_days}{" "}
                    {rule.threshold_days === 1 ? "day" : "days"} · {columnScope}
                  </p>
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => toggleEnabled(rule)}
                    disabled={disabled}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                  />
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  disabled={disabled}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(rule)}
                  disabled={disabled}
                  className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          columns={columns}
          onClose={() => setEditing(null)}
          onSaved={(savedRule) => {
            setRules((prev) => {
              const idx = prev.findIndex((r) => r.id === savedRule.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = savedRule;
                return next;
              }
              return [...prev, savedRule];
            });
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteDialog
          rule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setRules((prev) => prev.filter((r) => r.id !== deleting.id));
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule editor modal
// ---------------------------------------------------------------------------

function RuleEditor({
  rule,
  columns,
  onClose,
  onSaved,
}: {
  rule: CardWarningRule | null;
  columns: BoardColumn[];
  onClose: () => void;
  onSaved: (saved: CardWarningRule) => void;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [thresholdDays, setThresholdDays] = useState(
    String(rule?.threshold_days ?? 3)
  );
  const [color, setColor] = useState<CardWarningColor>(rule?.color ?? "amber");
  const [applyToAll, setApplyToAll] = useState(
    !rule || rule.apply_to_columns.length === 0
  );
  const [selectedColumns, setSelectedColumns] = useState<string[]>(
    rule?.apply_to_columns ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleColumn(id: string) {
    setApplyToAll(false);
    setSelectedColumns((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function handleAllColumns(checked: boolean) {
    setApplyToAll(checked);
    if (checked) setSelectedColumns([]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      threshold_days: parseInt(thresholdDays, 10),
      color,
      apply_to_columns: applyToAll ? [] : selectedColumns,
      enabled: rule?.enabled ?? true,
    };

    const res = await fetch(
      rule ? `/api/card-warning-rules/${rule.id}` : "/api/card-warning-rules",
      {
        method: rule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const json = (await res.json().catch(() => ({}))) as {
      rule?: CardWarningRule;
      error?: string;
    };

    if (!res.ok) {
      setError(json.error ?? "Failed to save");
      setSaving(false);
      return;
    }

    if (json.rule) onSaved(json.rule);
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? "Edit Warning Rule" : "Add Warning Rule"}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="card-warning-rule-form"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Warning"}
          </Button>
        </>
      }
    >
      <form
        id="card-warning-rule-form"
        onSubmit={save}
        className="space-y-5"
      >
        {/* Name */}
        <div>
          <Label htmlFor="cwr-name">Warning name</Label>
          <Input
            id="cwr-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='e.g. "Needs Attention"'
          />
        </div>

        {/* Threshold */}
        <div>
          <Label htmlFor="cwr-days">Trigger after (days)</Label>
          <Input
            id="cwr-days"
            type="number"
            min={1}
            required
            value={thresholdDays}
            onChange={(e) => setThresholdDays(e.target.value)}
            className="w-32"
          />
          <p className="mt-1 text-xs text-slate-400">
            Working days only (Mon–Fri). Card pulses this color if it stays in
            a watched column for this many working days without moving.
          </p>
        </div>

        {/* Color */}
        <div>
          <Label>Color</Label>
          <div className="mt-2 flex flex-wrap gap-3">
            {CARD_WARNING_COLORS.map((c) => (
              <label
                key={c}
                className="flex cursor-pointer items-center gap-1.5 text-sm"
              >
                <input
                  type="radio"
                  name="cwr-color"
                  value={c}
                  checked={color === c}
                  onChange={() =>
                    setColor(isCardWarningColor(c) ? c : "amber")
                  }
                  className="sr-only"
                />
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                    color === c
                      ? "border-slate-700 scale-110"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: CARD_WARNING_COLOR_SWATCHES[c] }}
                />
                <span
                  className={
                    color === c
                      ? "font-semibold text-slate-800"
                      : "text-slate-600"
                  }
                >
                  {CARD_WARNING_COLOR_LABELS[c]}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Apply to columns */}
        <div>
          <Label>Apply to columns</Label>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200 p-2">
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => handleAllColumns(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              />
              <span className="text-sm font-medium text-slate-700">
                All columns (default)
              </span>
            </label>
            <div className="my-1 border-t border-slate-100" />
            {columns.map((col) => (
              <label
                key={col.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={!applyToAll && selectedColumns.includes(col.id)}
                  onChange={() => toggleColumn(col.id)}
                  disabled={applyToAll}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 disabled:opacity-40"
                />
                <span
                  className={`text-sm ${
                    applyToAll ? "text-slate-400" : "text-slate-700"
                  }`}
                >
                  {col.name}
                </span>
              </label>
            ))}
          </div>
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

// ---------------------------------------------------------------------------
// Delete confirmation
// ---------------------------------------------------------------------------

function DeleteDialog({
  rule,
  onClose,
  onDeleted,
}: {
  rule: CardWarningRule;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    const res = await fetch(`/api/card-warning-rules/${rule.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted();
    } else {
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(json.error ?? "Failed to delete");
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Warning Rule"
      footer={
        <>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={confirm}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Delete the warning rule{" "}
        <strong>&ldquo;{rule.name}&rdquo;</strong>? Cards will no longer pulse
        with this rule&apos;s color.
      </p>
      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
