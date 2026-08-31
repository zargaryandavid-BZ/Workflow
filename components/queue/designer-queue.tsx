"use client";

import { useCallback, useEffect, useState } from "react";

type Designer = { id: string; name: string };
type QueueOrder = { id: string; title: string; priority: string; due_date: string | null; queue_pos: number };

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: "#fee2e2", fg: "#b91c1c" },
  high: { bg: "#ffedd5", fg: "#c2410c" },
  normal: { bg: "#e2e8f0", fg: "#475569" },
  low: { bg: "#f1f5f9", fg: "#64748b" },
};

export function DesignerQueue() {
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/designers/queue", { cache: "no-store" });
        const json = await res.json();
        setDesigners(json.designers ?? []);
        setCanAssign(Boolean(json.canAssign));
        const first = (json.designers ?? [])[0]?.id ?? "";
        setSelected(first);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadOrders = useCallback(async (designerId: string) => {
    if (!designerId) return;
    setMsg(null);
    const res = await fetch(`/api/designers/queue?designer_id=${encodeURIComponent(designerId)}`, { cache: "no-store" });
    const json = await res.json();
    setOrders(json.orders ?? []);
    setDirty(false);
  }, []);

  useEffect(() => {
    if (selected) void loadOrders(selected);
  }, [selected, loadOrders]);

  function move(index: number, dir: -1 | 1) {
    setOrders((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/designers/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designer_id: selected, order_ids: orders.map((o) => o.id) }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Failed to save"); return; }
      setDirty(false);
      setMsg("Queue saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Designer Queue</h1>
      <p className="mb-4 text-sm text-slate-500">
        {canAssign
          ? "Set the order each designer works their jobs — top of the list first. Use ↑ ↓ and Save."
          : "Your work queue — do them top to bottom."}
      </p>

      {canAssign && designers.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Designer</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
          >
            {designers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="text-xs font-medium text-amber-600">Unsaved changes</span>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? "Saving…" : dirty ? "Save order" : "Saved"}
            </button>
          </div>
        </div>
      )}

      {msg && <p className="mb-3 text-sm text-emerald-600">{msg}</p>}
      {canAssign && orders.length > 0 && (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          Order the jobs top-to-bottom with ↑ ↓, then Save order.
        </p>
      )}

      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          No open jobs assigned{canAssign ? " to this designer" : ""}.
        </p>
      ) : (
        <ol className="space-y-2">
          {orders.map((o, i) => {
            const ps = PRIORITY_STYLE[o.priority] ?? PRIORITY_STYLE.normal;
            return (
              <li key={o.id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{o.title || "Untitled"}</span>
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: ps.bg, color: ps.fg }}>
                  {o.priority}
                </span>
                {o.due_date && <span className="shrink-0 text-[11px] text-slate-400">{o.due_date}</span>}
                {canAssign && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30" aria-label="Move up">↑</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === orders.length - 1}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30" aria-label="Move down">↓</button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
