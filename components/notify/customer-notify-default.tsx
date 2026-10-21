"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  channelFromSelection,
  normalizePreferredChannel,
  preferredChannelFallbackNote,
  preferredChannelLabel,
} from "@/lib/preferred-channel";
import { saveCustomerPreferredChannel } from "@/lib/persist-preferred-channel";
import type { PreferredChannel } from "@/lib/types";

const OPTIONS: Array<{ value: PreferredChannel; label: string }> = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "both", label: "Both" },
];

function useSaveDefault(
  customerId: string | null | undefined,
  saved: PreferredChannel | string | null | undefined,
  onSaved?: (pref: PreferredChannel) => void
) {
  const [current, setCurrent] = useState<PreferredChannel>(
    normalizePreferredChannel(saved)
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    setCurrent(normalizePreferredChannel(saved));
  }, [saved]);

  async function save(pref: PreferredChannel, customerName?: string | null) {
    setSaving(true);
    setMessage(null);
    const result = await saveCustomerPreferredChannel(customerId, pref);
    setSaving(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return false;
    }
    const savedPref = normalizePreferredChannel(
      result.customer?.preferred_channel ?? pref
    );
    setCurrent(savedPref);
    setMessage({
      kind: "ok",
      text: `Saved. ${customerName?.trim() || "This customer"} will get ${preferredChannelLabel(savedPref)} by default on all orders.`,
    });
    onSaved?.(savedPref);
    return true;
  }

  return { current, saving, message, save };
}

/**
 * Inline "Save as default" for a send panel / popup. Staff pick Email / SMS /
 * Both for THIS send with the chips; the default only changes when they click
 * the button here.
 */
export function SaveChannelAsDefault({
  customerId,
  customerName,
  saved,
  selected,
  contact,
  onSaved,
  className,
}: {
  customerId: string | null | undefined;
  customerName?: string | null;
  saved: PreferredChannel | string | null | undefined;
  selected: ReadonlyArray<"email" | "sms">;
  /** Contact the panel sends to — explains an SMS/Email fallback. */
  contact?: { email: string | null | undefined; phone: string | null | undefined };
  onSaved?: (pref: PreferredChannel) => void;
  className?: string;
}) {
  const { current, saving, message, save } = useSaveDefault(
    customerId,
    saved,
    onSaved
  );
  const selection = channelFromSelection(selected);
  const fallbackNote = contact
    ? preferredChannelFallbackNote(contact, current)
    : null;

  if (!customerId) {
    return (
      <p className={cn("text-xs text-slate-500", className)}>
        Link this card to a customer to save how they get notified.
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600",
        className
      )}
    >
      <span>
        Always send to this customer by:{" "}
        <span className="font-semibold text-slate-800">
          {preferredChannelLabel(current)}
        </span>
      </span>
      {selection && selection !== current ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => void save(selection, customerName)}
          className="h-7 px-2 text-xs"
        >
          {saving
            ? "Saving…"
            : `Save ${preferredChannelLabel(selection)} as default`}
        </Button>
      ) : null}
      {fallbackNote ? (
        <span className="basis-full text-amber-700">{fallbackNote}</span>
      ) : null}
      {message ? (
        <span
          className={cn(
            "inline-flex items-center gap-1",
            message.kind === "ok" ? "text-emerald-700" : "text-red-600"
          )}
        >
          {message.kind === "ok" ? <Check className="h-3.5 w-3.5" /> : null}
          {message.text}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Explicit picker for the card's customer section:
 * "Always send to this customer by: Email / SMS / Both — Save as default".
 */
export function CustomerNotifyPreference({
  customerId,
  customerName,
  saved,
  onSaved,
  className,
}: {
  customerId: string | null | undefined;
  customerName?: string | null;
  saved: PreferredChannel | string | null | undefined;
  onSaved?: (pref: PreferredChannel) => void;
  className?: string;
}) {
  const { current, saving, message, save } = useSaveDefault(
    customerId,
    saved,
    onSaved
  );
  const [draft, setDraft] = useState<PreferredChannel>(current);

  useEffect(() => {
    setDraft(current);
  }, [current]);

  if (!customerId) return null;

  return (
    <div className={cn("space-y-1", className)}>
      <p className="text-xs font-medium text-slate-600">
        Always send to this customer by
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setDraft(opt.value)}
            className={cn(
              "rounded-md border px-3 py-1 text-sm font-medium",
              draft === opt.value
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
          >
            {opt.label}
          </button>
        ))}
        <Button
          type="button"
          size="sm"
          disabled={saving || draft === current}
          onClick={() => void save(draft, customerName)}
        >
          {saving ? "Saving…" : "Save as default"}
        </Button>
      </div>
      {message ? (
        <p
          className={cn(
            "inline-flex items-center gap-1 text-xs",
            message.kind === "ok" ? "text-emerald-700" : "text-red-600"
          )}
        >
          {message.kind === "ok" ? <Check className="h-3.5 w-3.5" /> : null}
          {message.text}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          Used for approvals, missing info, ready to ship / pickup, shipped and
          automatic messages on all this customer&apos;s orders. You can still
          change it for a single send.
        </p>
      )}
    </div>
  );
}
