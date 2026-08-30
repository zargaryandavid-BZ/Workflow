"use client";

import { useCallback, useEffect, useState } from "react";

type Designer = { id: string; name: string };
type QueueOrder = {
  id: string;
  title: string;
  customer: string | null;
  priority: string;
  priority_score: number | null;
  spec: string | null;
  due_label: string | null;
  due_date: string | null;
  queue_pos: number;
};
type DesignerLane = Designer & { orders: QueueOrder[] };

function dueText(o: QueueOrder): string | null {
  if (o.due_label) return o.due_label;
  if (o.due_date) return `Due ${o.due_date}`;
  return null;
}

const PRIORITY_STYLE: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: "#fee2e2", fg: "#b91c1c" },
  high: { bg: "#ffedd5", fg: "#c2410c" },
  normal: { bg: "#e2e8f0", fg: "#475569" },
  low: { bg: "#f1f5f9", fg: "#64748b" },
};

// Big rank badge — colored so #1 reads instantly and later ranks fade back.
function rankStyle(rank: number): { bg: string; fg: string; ring: string } {
  if (rank === 1) return { bg: "#065f46", fg: "#ffffff", ring: "#10b981" }; // #1 = green, work this first
  if (rank === 2) return { bg: "#1e40af", fg: "#ffffff", ring: "#3b82f6" };
  if (rank === 3) return { bg: "#7c3aed", fg: "#ffffff", ring: "#a78bfa" };
  return { bg: "#e2e8f0", fg: "#475569", ring: "#cbd5e1" };
}

function PriorityTag({ priority }: { priority: string }) {
  const ps = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.normal;
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
      style={{ background: ps.bg, color: ps.fg }}
    >
      {priority}
    </span>
  );
}

export function DesignerQueue() {
  const [lanes, setLanes] = useState<DesignerLane[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setMsg(null);
    // Managers get every designer in one call; a designer gets only themselves.
    const mgrRes = await fetch("/api/designers/queue?all=1", { cache: "no-store" });
    if (mgrRes.ok) {
      const json = await mgrRes.json();
      setCanAssign(Boolean(json.canAssign));
      setLanes(json.designers ?? []);
      setDirty(new Set());
      setLoading(false);
      return;
    }
    // Not a manager → load own queue.
    const meta = await (await fetch("/api/designers/queue", { cache: "no-store" })).json();
    const selfId = meta.self ?? (meta.designers ?? [])[0]?.id ?? "";
    const mine = await (
      await fetch(`/api/designers/queue?designer_id=${encodeURIComponent(selfId)}`, {
        cache: "no-store",
      })
    ).json();
    setCanAssign(false);
    setLanes([{ id: selfId, name: "You", orders: mine.orders ?? [] }]);
    setDirty(new Set());
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function move(designerId: string, index: number, dir: -1 | 1) {
    setLanes((prev) =>
      prev.map((lane) => {
        if (lane.id !== designerId) return lane;
        const next = [...lane.orders];
        const j = index + dir;
        if (j < 0 || j >= next.length) return lane;
        [next[index], next[j]] = [next[j], next[index]];
        return { ...lane, orders: next };
      })
    );
    setDirty((prev) => new Set(prev).add(designerId));
  }

  async function saveLane(designerId: string) {
    const lane = lanes.find((l) => l.id === designerId);
    if (!lane) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/designers/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designer_id: designerId, order_ids: lane.orders.map((o) => o.id) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error ?? "Failed to save");
        return;
      }
      setDirty((prev) => {
        const n = new Set(prev);
        n.delete(designerId);
        return n;
      });
      setMsg(`${lane.name}'s queue saved.`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading…</div>;

  const maxLen = Math.max(1, ...lanes.map((l) => l.orders.length));

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <h1 className="mb-1 text-xl font-semibold text-slate-800">Designer Queue</h1>
      <p className="mb-5 text-sm text-slate-500">
        {canAssign
          ? "Every designer's queue, top to bottom. Row 1 is what each of them works FIRST. Reorder with ↑ ↓, then Save."
          : "Your work queue — do them top to bottom, #1 first."}
      </p>

      {msg && <p className="mb-3 text-sm text-emerald-600">{msg}</p>}

      {canAssign ? (
        /* ---- Manager view: designers as columns, rank rows aligned ---- */
        <div className="overflow-x-auto pb-4">
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `56px repeat(${lanes.length}, minmax(220px, 1fr))`,
            }}
          >
            {/* header row */}
            <div />
            {lanes.map((lane) => (
              <div key={lane.id} className="flex items-center justify-between gap-2 px-1">
                <span className="truncate text-sm font-semibold text-slate-800">{lane.name}</span>
                {dirty.has(lane.id) && (
                  <button
                    type="button"
                    onClick={() => void saveLane(lane.id)}
                    disabled={saving}
                    className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            ))}

            {/* one row per rank; row N shows every designer's Nth card */}
            {Array.from({ length: maxLen }, (_, rankIdx) => {
              const rank = rankIdx + 1;
              const rs = rankStyle(rank);
              return (
                <div key={rank} className="contents">
                  <div className="flex items-start justify-center pt-1">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ring-2"
                      style={{ background: rs.bg, color: rs.fg, boxShadow: `0 0 0 3px ${rs.ring}22` }}
                    >
                      {rank}
                    </span>
                  </div>
                  {lanes.map((lane) => {
                    const o = lane.orders[rankIdx];
                    if (!o)
                      return (
                        <div
                          key={lane.id}
                          className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60"
                        />
                      );
                    return (
                      <div
                        key={lane.id}
                        className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
                        style={rank === 1 ? { borderColor: "#10b981", background: "#ecfdf5" } : undefined}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                            {o.customer && (
                              <span className="truncate text-sm font-semibold text-slate-800">
                                {o.customer}
                              </span>
                            )}
                            {o.priority_score != null && (
                              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                                P{o.priority_score}
                              </span>
                            )}
                          </div>
                          <span className="flex shrink-0 flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => move(lane.id, rankIdx, -1)}
                              disabled={rankIdx === 0}
                              className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-25"
                              aria-label="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => move(lane.id, rankIdx, 1)}
                              disabled={rankIdx === lane.orders.length - 1}
                              className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-25"
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                          </span>
                        </div>
                        <span className="text-xs leading-snug text-slate-500">
                          {o.title || "Untitled"}
                        </span>
                        {o.spec && (
                          <span className="text-[11px] tabular-nums text-slate-400">{o.spec}</span>
                        )}
                        <div className="mt-0.5 flex items-center gap-2">
                          <PriorityTag priority={o.priority} />
                          {dueText(o) && (
                            <span className="text-[11px] text-slate-400">{dueText(o)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ---- Designer view: single big-numbered list ---- */
        <div className="max-w-2xl">
          {(lanes[0]?.orders ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No open jobs assigned to you.
            </p>
          ) : (
            <ol className="space-y-2">
              {(lanes[0]?.orders ?? []).map((o, i) => {
                const rs = rankStyle(i + 1);
                return (
                  <li
                    key={o.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3"
                    style={i === 0 ? { borderColor: "#10b981", background: "#ecfdf5" } : undefined}
                  >
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-bold"
                      style={{ background: rs.bg, color: rs.fg }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        {o.customer && (
                          <span className="truncate text-sm font-semibold text-slate-800">
                            {o.customer}
                          </span>
                        )}
                        {o.priority_score != null && (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                            P{o.priority_score}
                          </span>
                        )}
                      </div>
                      <span className="truncate text-xs text-slate-500">{o.title || "Untitled"}</span>
                      {o.spec && (
                        <span className="truncate text-[11px] tabular-nums text-slate-400">{o.spec}</span>
                      )}
                    </div>
                    <PriorityTag priority={o.priority} />
                    {dueText(o) && (
                      <span className="shrink-0 text-[11px] text-slate-400">{dueText(o)}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
