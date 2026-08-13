"use client";

import { useState } from "react";

export function WarehouseConfirmForm({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch(
        `/api/warehouse-confirm/${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || undefined }),
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setStatus("error");
        setError(json.error ?? "Could not confirm. Try again.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setError("Network error. Try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-5 rounded-lg bg-emerald-50 p-4 text-center">
        <p className="text-sm font-semibold text-emerald-700">
          Thank you — stock confirmed.
        </p>
        <p className="mt-1 text-xs text-emerald-600">
          The order can now be released to Ready to Ship.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <label className="block text-sm font-medium text-slate-700">
        Your name (optional)
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Who is confirming?"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500"
        />
      </label>

      {error ? (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={status === "submitting"}
        className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {status === "submitting"
          ? "Confirming…"
          : "Confirm containers are in stock"}
      </button>
    </div>
  );
}
