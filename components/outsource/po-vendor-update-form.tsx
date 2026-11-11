"use client";

import { useState } from "react";

const OPTIONS = [
  { value: "confirmed", label: "Order confirmed" },
  { value: "in_production", label: "In production" },
  { value: "shipped", label: "Shipped" },
];

export function PoVendorUpdateForm({ token }: { token: string }) {
  const [status, setStatus] = useState("confirmed");
  const [note, setNote] = useState("");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/po/${encodeURIComponent(token)}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note, tracking }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
        Thank you — your update was sent to Bazaar Printing.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-800">Post an update</p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setStatus(o.value)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              status === o.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-300 bg-white text-slate-700"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {status === "shipped" ? (
        <input
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder="Tracking number"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      ) : null}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Ship date, questions, or anything we should know"
        rows={3}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send update"}
      </button>
    </form>
  );
}
