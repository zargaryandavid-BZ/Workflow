"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import {
  FAST_ACTION_COLOR_CLASSES,
  filterFastActionButtons,
  isFastActionButtonColor,
} from "@/lib/fast-action-buttons";
import { cn } from "@/lib/utils";
import type { FastActionButton, Role } from "@/lib/types";

interface FastActionButtonBarProps {
  buttons: FastActionButton[];
  currentColumnId: string;
  orderId: string;
  role: Role;
  userId?: string;
  onSuccess: (destinationName: string) => void;
  onError: (message: string) => void;
}

export function FastActionButtonBar({
  buttons,
  currentColumnId,
  orderId,
  role,
  userId,
  onSuccess,
  onError,
}: FastActionButtonBarProps) {
  const visible = filterFastActionButtons(buttons, currentColumnId, role, userId);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Fast Buttons
      </p>
      <div className="flex flex-col gap-1.5">
        {visible.map((btn) => (
          <FastActionButtonPill
            key={btn.id}
            button={btn}
            orderId={orderId}
            onSuccess={onSuccess}
            onError={onError}
          />
        ))}
      </div>
    </div>
  );
}

function FastActionButtonPill({
  button,
  orderId,
  onSuccess,
  onError,
}: {
  button: FastActionButton;
  orderId: string;
  onSuccess: (destinationName: string) => void;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const color = isFastActionButtonColor(button.color) ? button.color : "blue";

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/fast-action-buttons/${button.id}/trigger`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: orderId }),
        }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        onError(json.error ?? "Could not move card. Please try again.");
        return;
      }
      onSuccess(button.destination_column?.name ?? "new column");
    } catch {
      onError("Could not move card. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-opacity disabled:opacity-50",
        FAST_ACTION_COLOR_CLASSES[color]
      )}
    >
      {loading ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <ArrowRight className="h-2.5 w-2.5" />
      )}
      {button.name}
    </button>
  );
}
