"use client";

import { useState } from "react";
import { AlertTriangle, LogIn, LogOut, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DieOrderPicker, type DieOrderHit } from "@/components/die/die-order-picker";
import { dieUseBlocker, type Die } from "@/lib/dies";
import { cn } from "@/lib/utils";

/**
 * Use die → popup: pick the order (its total qty fills in) and how many uses
 * to add. Return die hands it back right away. Any signed-in staff member;
 * who, when, order and qty go into the die's history.
 */
export function DieUseButton({
  die,
  onChanged,
  size = "sm",
}: {
  die: Die;
  onChanged: (die: Die) => void;
  size?: "sm" | "lg";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const checkedOut = Boolean(die.checked_out_at);
  const blocker = checkedOut ? null : dieUseBlocker(die);

  async function send(body: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(`/api/dies/${die.id}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; die?: Die };
    if (!res.ok || !json.die) return json.error ?? "Could not update the die";
    onChanged(json.die);
    return null;
  }

  async function returnDie() {
    setBusy(true);
    setError(null);
    const failed = await send({ action: "return" });
    if (failed) setError(failed);
    setBusy(false);
  }

  const Icon = checkedOut ? LogIn : LogOut;
  return (
    <span className={cn("inline-flex flex-col", size === "lg" ? "items-stretch" : "items-end")}>
      <button
        type="button"
        onClick={() => (checkedOut ? void returnDie() : setOpen(true))}
        disabled={busy || Boolean(blocker)}
        title={blocker ?? undefined}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          size === "lg" ? "h-12 px-5 text-base" : "px-2 py-1 text-xs",
          checkedOut
            ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
            : "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
        )}
      >
        <Icon className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} />
        {busy ? "Saving…" : checkedOut ? "Return die" : "Use die"}
      </button>
      {error ? (
        <span className={cn("mt-1 text-red-600", size === "lg" ? "text-sm" : "max-w-[12rem] text-[11px]")}>
          {error}
        </span>
      ) : null}
      {open ? (
        // The popup is portaled, but React still bubbles its clicks to the
        // table row (which opens the QR window) — stop them here.
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
        <UseDieModal
          die={die}
          onClose={() => setOpen(false)}
          onUse={async (body) => {
            const failed = await send({ action: "use", ...body });
            if (!failed) setOpen(false);
            return failed;
          }}
        />
        </span>
      ) : null}
    </span>
  );
}

function UseDieModal({
  die,
  onClose,
  onUse,
}: {
  die: Die;
  onClose: () => void;
  onUse: (body: { order_id: string; qty: number | null; uses: number }) => Promise<string | null>;
}) {
  const [order, setOrder] = useState<DieOrderHit | null>(null);
  const [uses, setUses] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usesNum = Number(uses);
  const usesOk = Number.isInteger(usesNum) && usesNum >= 1;
  const after = die.use_count + (usesOk ? usesNum : 0);
  const overMax = Boolean(die.max_uses && after > die.max_uses);
  const qty = order?.totalQty ?? null;

  async function submit() {
    setError(null);
    if (!order) return setError("Pick the order this die is used for.");
    if (!usesOk) return setError("Uses to add must be a whole number of 1 or more.");
    setSaving(true);
    const failed = await onUse({ order_id: order.id, qty, uses: usesNum });
    setSaving(false);
    if (failed) setError(failed);
  }

  return (
    <Modal
      open
      onClose={onClose}
      className="max-w-md"
      title={
        <span>
          Use die
          <span className="ml-2 font-mono text-xs font-medium text-slate-500">
            {die.template_code} · {die.name}
          </span>
        </span>
      }
      footer={
        <>
          <span />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className={cn("inline-flex items-center gap-1.5", overMax && "bg-amber-600 hover:bg-amber-700")}
            >
              <LogOut className="h-4 w-4" />
              {saving ? "Saving…" : overMax ? "Use anyway" : "Use die"}
            </Button>
          </div>
        </>
      }
    >
      <form
        className="space-y-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor="use-die-order">Order number *</Label>
          <DieOrderPicker
            id="use-die-order"
            initialText=""
            onClear={() => setOrder(null)}
            onPick={(hit) => setOrder(hit)}
          />
          {order ? (
            <p className="mt-1 text-xs text-slate-500">
              {[order.customerName, order.productName].filter(Boolean).join(" · ") || order.title}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Total qty</Label>
            <p
              className={cn(
                "mt-1 flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm tabular-nums",
                qty ? "font-semibold text-slate-900" : "text-slate-400"
              )}
              title="From the order"
            >
              {order ? (qty ? qty.toLocaleString("en-US") : "Not on the order") : "Pick an order"}
            </p>
          </div>
          <div>
            <Label htmlFor="use-die-uses">Uses to add</Label>
            <div className="mt-1 flex h-10 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white">
              <button
                type="button"
                aria-label="One less"
                onClick={() => setUses(String(Math.max(1, (usesOk ? usesNum : 1) - 1)))}
                className="px-2.5 text-slate-500 hover:bg-slate-50"
              >
                <Minus className="h-4 w-4" />
              </button>
              <Input
                id="use-die-uses"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={uses}
                onChange={(e) => setUses(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-full min-w-0 flex-1 rounded-none border-0 text-center tabular-nums focus:ring-0"
              />
              <button
                type="button"
                aria-label="One more"
                onClick={() => setUses(String((usesOk ? usesNum : 0) + 1))}
                className="px-2.5 text-slate-500 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Uses: <span className="tabular-nums">{die.use_count.toLocaleString("en-US")}</span> →{" "}
          <span className="font-semibold tabular-nums">{after.toLocaleString("en-US")}</span>
          {die.max_uses ? (
            <span className="text-slate-500"> of {die.max_uses.toLocaleString("en-US")} max</span>
          ) : null}
        </p>
        {overMax ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            This goes past the die&apos;s max uses. Consider a reorder.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
