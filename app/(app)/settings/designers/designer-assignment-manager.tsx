"use client";

import { useState } from "react";
import type { DesignerAssignmentSettings } from "@/lib/designer-assignment-settings";

type Designer = { id: string; name: string };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DesignerAssignmentManager({
  initial,
  designers,
  migrationRequired,
}: {
  initial: DesignerAssignmentSettings;
  designers: Designer[];
  migrationRequired: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [pool, setPool] = useState<string[]>(initial.pool);
  const [staleHours, setStaleHours] = useState<string>(
    initial.staleHours > 0 ? String(initial.staleHours) : ""
  );
  const [workingDays, setWorkingDays] = useState<number[]>(initial.workingDays);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  function togglePool(id: string) {
    setPool((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  function toggleDay(d: number) {
    setWorkingDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings/designer-assignment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          pool,
          staleHours: staleHours.trim() === "" ? 0 : Number(staleHours),
          workingDays,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setMsg({ kind: "ok", text: "Saved." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (migrationRequired) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Designer settings need a database update before they can be used. Run the
        latest migration, then reload this page.
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* Auto-assign */}
      <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-sm">
          <span className="font-medium text-slate-800">
            Auto-assign new orders to the least-busy designer
          </span>
          <span className="mt-0.5 block text-slate-500">
            When an order arrives with no designer, it goes to whoever in the
            pool has the fewest open jobs.
          </span>
        </span>
      </label>

      {/* Pool */}
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">
          Designer pool
        </div>
        {designers.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
            No one has the Designer role yet — add it in Team settings.
          </p>
        ) : (
          <div className="space-y-1.5">
            {designers.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={pool.includes(d.id)}
                  onChange={() => togglePool(d.id)}
                  className="h-4 w-4"
                />
                <span className="text-slate-800">{d.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Stale transfer */}
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm font-medium text-slate-800">
          Move a stale job to another designer
        </div>
        <p className="mt-0.5 text-sm text-slate-500">
          If a job sits with one designer longer than this during working hours,
          it transfers to the next least-busy designer in the pool. Leave blank
          (or 0) to turn this off.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={staleHours}
            onChange={(e) => setStaleHours(e.target.value)}
            placeholder="e.g. 24"
            className="w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-slate-600">working hours</span>
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Working days
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((lbl, d) => {
              const on = workingDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={
                    "rounded-md border px-2.5 py-1 text-xs font-medium " +
                    (on
                      ? "border-slate-800 bg-slate-800 text-white"
                      : "border-slate-300 bg-white text-slate-600")
                  }
                >
                  {lbl}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span
            className={
              "text-sm " + (msg.kind === "ok" ? "text-emerald-600" : "text-rose-600")
            }
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
