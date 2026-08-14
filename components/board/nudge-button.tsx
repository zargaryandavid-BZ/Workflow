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
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void nudge()}
        disabled={busy}
        title="Text the assigned designer a reminder"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        Nudge designer
      </button>
      {msg ? (
        <span
          className={msg.ok ? "text-xs text-emerald-600" : "text-xs text-red-600"}
        >
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}
