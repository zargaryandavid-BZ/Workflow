"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { itemLabel } from "@/lib/group-orders";
import { dateInputValue, localDateInputValue } from "@/lib/utils";
import type { OrderWithRelations } from "@/lib/types";

export interface GroupDueDateUpdate {
  orderId: string;
  dueDate: string | null;
}

interface GroupDueDatesModalProps {
  open: boolean;
  orders: OrderWithRelations[];
  groupKey: string;
  onClose: () => void;
  onSave: (updates: GroupDueDateUpdate[]) => Promise<void>;
}

export function GroupDueDatesModal({
  open,
  orders,
  groupKey,
  onClose,
  onSave,
}: GroupDueDatesModalProps) {
  const sorted = [...orders].sort((a, b) => {
    const ai =
      typeof a.specs?.webhook_item_index === "number"
        ? a.specs.webhook_item_index
        : 999;
    const bi =
      typeof b.specs?.webhook_item_index === "number"
        ? b.specs.webhook_item_index
        : 999;
    if (ai !== bi) return ai - bi;
    return a.position - b.position;
  });

  const [datesById, setDatesById] = useState<Record<string, string>>({});
  const [sameForAll, setSameForAll] = useState(true);
  const [sameDate, setSameDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, string> = {};
    for (const order of sorted) {
      initial[order.id] = dateInputValue(order.due_date);
    }
    const uniqueDates = [
      ...new Set(Object.values(initial).filter(Boolean)),
    ];
    // Prefer a shared existing date; otherwise leave blank for the user to pick.
    const seed = uniqueDates.length === 1 ? uniqueDates[0] : "";
    const dates =
      seed
        ? Object.fromEntries(sorted.map((o) => [o.id, seed]))
        : initial;
    setDatesById(dates);
    setSameForAll(true);
    setSameDate(seed);
    setError(null);
    setSaving(false);
  }, [open, orders]);

  function setDateForOrder(orderId: string, value: string) {
    setDatesById((prev) => ({ ...prev, [orderId]: value }));
    if (sameForAll) setSameDate(value);
  }

  function applySameDate(value: string) {
    setSameDate(value);
    if (!sameForAll) return;
    setDatesById((prev) => {
      const next = { ...prev };
      for (const order of sorted) {
        next[order.id] = value;
      }
      return next;
    });
  }

  function toggleSameForAll(checked: boolean) {
    setSameForAll(checked);
    if (checked) {
      const seed = sameDate || localDateInputValue();
      setSameDate(seed);
      setDatesById((prev) => {
        const next = { ...prev };
        for (const order of sorted) {
          next[order.id] = seed;
        }
        return next;
      });
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates: GroupDueDateUpdate[] = sorted.map((order) => ({
        orderId: order.id,
        dueDate: datesById[order.id]?.trim() || null,
      }));
      await onSave(updates);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save due dates");
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-md"
      title={
        <span className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-slate-500" />
          <span>Set due dates</span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        {groupKey} — {orders.length} items in this column
      </p>

      <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={sameForAll}
          onChange={(e) => toggleSameForAll(e.target.checked)}
          className="rounded border-slate-300"
        />
        Same date for all
      </label>

      {sameForAll ? (
        <div className="mb-4">
          <Label htmlFor="group-same-due-date">Due date</Label>
          <Input
            id="group-same-due-date"
            type="date"
            value={sameDate}
            onChange={(e) => applySameDate(e.target.value)}
            className="mt-1"
          />
        </div>
      ) : null}

      <div className="max-h-72 space-y-3 overflow-y-auto">
        {sorted.map((order, idx) => (
          <div key={order.id} className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
            <p className="mb-2 truncate text-sm font-medium text-slate-800">
              {idx + 1}. {itemLabel(order)}
            </p>
            {sameForAll ? (
              <p className="text-xs text-slate-500">
                {datesById[order.id]
                  ? dateInputValue(datesById[order.id])
                  : "No date"}
              </p>
            ) : (
              <Input
                type="date"
                value={datesById[order.id] ?? ""}
                onChange={(e) => setDateForOrder(order.id, e.target.value)}
                aria-label={`Due date for ${itemLabel(order)}`}
              />
            )}
          </div>
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
