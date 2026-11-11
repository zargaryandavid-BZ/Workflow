"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import {
  PO_STATUS_LABEL,
  poTotal,
  type PoHistoryEntry,
  type PoItem,
} from "@/lib/purchase-order";

type Vendor = { id: string; name: string; email: string; contact_name: string | null };

type PurchaseOrder = {
  id: string;
  po_number: string;
  status: string;
  vendor_id: string | null;
  items: PoItem[];
  ship_to: string | null;
  due_date: string | null;
  notes: string | null;
  folder_url: string | null;
  sent_at: string | null;
  vendor_status: string | null;
  vendor_note: string | null;
  vendor_tracking: string | null;
  vendor_updated_at: string | null;
  history: PoHistoryEntry[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const input =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

/** Outsource column: editable PO from the card, send to vendor, request updates. */
export function PurchaseOrderPanel({ orderId }: { orderId: string }) {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<PurchaseOrder | null>(null);
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendor, setNewVendor] = useState({ name: "", contact_name: "", email: "", phone: "" });
  const [updateMsg, setUpdateMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, v] = await Promise.all([
        api<{ purchaseOrders: PurchaseOrder[] }>(
          `/api/purchase-orders?orderId=${encodeURIComponent(orderId)}`
        ),
        api<{ vendors: Vendor[] }>("/api/outsource-vendors"),
      ]);
      setPos(p.purchaseOrders);
      setVendors(v.vendors);
      const latest = p.purchaseOrders[p.purchaseOrders.length - 1] ?? null;
      setDraft(latest ? { ...latest, items: latest.items ?? [] } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load purchase orders.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<PurchaseOrder | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await fn();
      if (next) {
        setDraft(next);
        setPos((prev) => {
          const i = prev.findIndex((p) => p.id === next.id);
          return i >= 0 ? prev.map((p) => (p.id === next.id ? next : p)) : [...prev, next];
        });
      }
      setNotice(label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run("Purchase order created — review it, then send.", async () => {
      const r = await api<{ purchaseOrder: PurchaseOrder }>("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      });
      return r.purchaseOrder;
    });

  const save = (extra: Record<string, unknown> = {}, label = "Saved.") =>
    run(label, async () => {
      if (!draft) return;
      const r = await api<{ purchaseOrder: PurchaseOrder }>(`/api/purchase-orders/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          po_number: draft.po_number,
          vendor_id: draft.vendor_id,
          items: draft.items,
          ship_to: draft.ship_to,
          due_date: draft.due_date,
          notes: draft.notes,
          folder_url: draft.folder_url,
          ...extra,
        }),
      });
      return r.purchaseOrder;
    });

  const send = () =>
    run("Sent to the vendor.", async () => {
      if (!draft) return;
      await api(`/api/purchase-orders/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          po_number: draft.po_number,
          vendor_id: draft.vendor_id,
          items: draft.items,
          ship_to: draft.ship_to,
          due_date: draft.due_date,
          notes: draft.notes,
          folder_url: draft.folder_url,
        }),
      });
      const r = await api<{ purchaseOrder: PurchaseOrder }>(
        `/api/purchase-orders/${draft.id}/send`,
        { method: "POST" }
      );
      return r.purchaseOrder;
    });

  const requestUpdate = () =>
    run("Update requested from the vendor.", async () => {
      if (!draft) return;
      const r = await api<{ purchaseOrder: PurchaseOrder }>(
        `/api/purchase-orders/${draft.id}/request-update`,
        { method: "POST", body: JSON.stringify({ message: updateMsg }) }
      );
      setUpdateMsg("");
      return r.purchaseOrder;
    });

  const addVendor = () =>
    run("Vendor added.", async () => {
      const r = await api<{ vendor: Vendor }>("/api/outsource-vendors", {
        method: "POST",
        body: JSON.stringify(newVendor),
      });
      setVendors((v) => [...v, r.vendor].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((d) => (d ? { ...d, vendor_id: r.vendor.id } : d));
      setAddingVendor(false);
      setNewVendor({ name: "", contact_name: "", email: "", phone: "" });
    });

  const setItem = (i: number, patch: Partial<PoItem>) =>
    setDraft((d) =>
      d ? { ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) } : d
    );

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  if (loading) return <p className="py-6 text-center text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4 text-sm">
      {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">{notice}</p> : null}

      {pos.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {pos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setDraft(p)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                draft?.id === p.id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300"
              }`}
            >
              {p.po_number}
            </button>
          ))}
        </div>
      ) : null}

      {!draft ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="mb-3 text-slate-600">No purchase order for this card yet.</p>
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Create PO
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              className={`${input} max-w-[16rem] font-semibold`}
              value={draft.po_number}
              onChange={(e) => setDraft({ ...draft, po_number: e.target.value })}
            />
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
              {PO_STATUS_LABEL[draft.status] ?? draft.status}
            </span>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Vendor</label>
            <div className="flex gap-2">
              <select
                className={input}
                value={draft.vendor_id ?? ""}
                onChange={(e) => setDraft({ ...draft, vendor_id: e.target.value || null })}
              >
                <option value="">Pick a vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.email}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAddingVendor((x) => !x)}
                className="shrink-0 rounded-md border border-slate-300 px-3 text-xs"
              >
                + New vendor
              </button>
            </div>
            {addingVendor ? (
              <div className="mt-2 grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-2">
                {(["name", "contact_name", "email", "phone"] as const).map((k) => (
                  <input
                    key={k}
                    className={input}
                    placeholder={{ name: "Company", contact_name: "Contact name", email: "Email", phone: "Phone" }[k]}
                    value={newVendor[k]}
                    onChange={(e) => setNewVendor({ ...newVendor, [k]: e.target.value })}
                  />
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={addVendor}
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white sm:col-span-2"
                >
                  Save vendor
                </button>
              </div>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Items</label>
            <div className="space-y-2">
              {draft.items.map((it, i) => (
                <div key={i} className="space-y-1.5 rounded-md border border-slate-200 p-2">
                  <div className="flex gap-2">
                    <input
                      className={input}
                      value={it.description}
                      placeholder="Item"
                      onChange={(e) => setItem(i, { description: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })
                      }
                      className="shrink-0 px-2 text-xs text-slate-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                  <textarea
                    className={input}
                    rows={2}
                    value={it.specs}
                    placeholder="Specs"
                    onChange={(e) => setItem(i, { specs: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <input
                      className={input}
                      inputMode="numeric"
                      placeholder="Qty"
                      value={it.qty ?? ""}
                      onChange={(e) => setItem(i, { qty: numOrNull(e.target.value) })}
                    />
                    <input
                      className={input}
                      inputMode="decimal"
                      placeholder="Unit cost $"
                      value={it.unit_cost ?? ""}
                      onChange={(e) => setItem(i, { unit_cost: numOrNull(e.target.value) })}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: [...draft.items, { description: "", specs: "", qty: null, unit_cost: null }],
                  })
                }
                className="text-xs font-medium text-blue-700"
              >
                + Add item
              </button>
              {poTotal(draft.items) != null ? (
                <p className="text-right font-semibold">Total: ${poTotal(draft.items)!.toFixed(2)}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Needed by</label>
              <input
                type="date"
                className={input}
                value={draft.due_date ?? ""}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Ship to</label>
              <textarea
                className={input}
                rows={3}
                value={draft.ship_to ?? ""}
                onChange={(e) => setDraft({ ...draft, ship_to: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">File folder link</label>
            <input
              className={input}
              value={draft.folder_url ?? ""}
              placeholder="https://drive.google.com/…"
              onChange={(e) => setDraft({ ...draft, folder_url: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              The vendor gets this link — make sure the folder is shared with them.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-400">Notes to vendor</label>
            <textarea
              className={input}
              rows={2}
              value={draft.notes ?? ""}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => save()}
              className="rounded-md border border-slate-300 px-3 py-2 font-medium disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy || !draft.vendor_id}
              onClick={send}
              className="rounded-md bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
            >
              {draft.sent_at ? "Resend to vendor" : "Send to vendor"}
            </button>
            {draft.status !== "received" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => save({ status: "received" }, "Marked received.")}
                className="rounded-md border border-emerald-600 px-3 py-2 font-medium text-emerald-700 disabled:opacity-50"
              >
                Mark received
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={create}
              className="rounded-md border border-slate-300 px-3 py-2 text-xs disabled:opacity-50"
            >
              New PO
            </button>
          </div>

          {draft.sent_at ? (
            <div className="space-y-2 rounded-md border border-slate-200 p-2">
              <p className="text-xs font-semibold uppercase text-slate-400">Request an update</p>
              <textarea
                className={input}
                rows={2}
                placeholder="Optional message (e.g. Can you confirm the ship date?)"
                value={updateMsg}
                onChange={(e) => setUpdateMsg(e.target.value)}
              />
              <button
                type="button"
                disabled={busy}
                onClick={requestUpdate}
                className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Request update
              </button>
            </div>
          ) : null}

          {draft.vendor_updated_at ? (
            <div className="rounded-md bg-blue-50 p-2 text-blue-900">
              <p className="font-semibold">
                Vendor: {PO_STATUS_LABEL[draft.vendor_status ?? ""] ?? draft.vendor_status}
                {draft.vendor_tracking ? ` · Tracking ${draft.vendor_tracking}` : ""}
              </p>
              {draft.vendor_note ? <p className="mt-0.5">{draft.vendor_note}</p> : null}
              <p className="mt-0.5 text-[11px] opacity-70">
                {new Date(draft.vendor_updated_at).toLocaleString()}
              </p>
            </div>
          ) : null}

          {draft.history?.length ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-slate-400">History</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {[...draft.history].reverse().map((h, i) => (
                  <li key={i}>
                    <span className="text-slate-400">{new Date(h.at).toLocaleString()}</span> · {h.by}:{" "}
                    {h.action}
                    {h.note ? ` — “${h.note}”` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
