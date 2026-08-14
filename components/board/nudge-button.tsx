"use client";

import { useState } from "react";
import { Bell, Loader2 } from "lucide-react";

/** Texts the assigned designer a short "this job is waiting on you" reminder. */
export function NudgeButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function nudge() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "designer" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        nudged?: string | null;
      };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't send the nudge." });
        return;
      }
      setMsg({
        ok: true,
        text: json.nudged ? `Nudged ${json.nudged}.` : "Nudge sent.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={() => void nudge()}
        disabled={busy}
        title={msg?.text ?? "Text the assigned designer a reminder"}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <Bell className="h-3.5 w-3.5 shrink-0" />
        )}
        Nudge
      </button>
      {msg ? (
        <span
          className={
            msg.ok
              ? "absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 shadow-sm"
              : "absolute left-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-red-50 px-2 py-0.5 text-xs text-red-600 shadow-sm"
          }
        >
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}
