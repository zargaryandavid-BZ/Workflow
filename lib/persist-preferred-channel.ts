"use client";

import type { PreferredChannel } from "@/lib/types";
import {
  preferredChannelFromSelection,
  toggleSendChannelSelection,
} from "@/lib/preferred-channel";

/** Save Settings → Customers default channel when staff pick Email or SMS only. */
export function persistCustomerPreferredChannel(
  customerId: string | null | undefined,
  channel: PreferredChannel
): void {
  if (!customerId) return;
  void fetch(`/api/customers/${customerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferred_channel: channel }),
  }).catch(() => {
    /* non-blocking — send still works */
  });
}

export function toggleAndPersistNotifyChannel(
  prev: ReadonlyArray<"email" | "sms">,
  next: "email" | "sms",
  customerId: string | null | undefined,
  customer?: { preferred_channel?: PreferredChannel } | null
): Array<"email" | "sms"> {
  const nextSel = toggleSendChannelSelection(prev, next);
  const preferred = preferredChannelFromSelection(nextSel);
  if (preferred) {
    persistCustomerPreferredChannel(customerId, preferred);
    if (customer) customer.preferred_channel = preferred;
  }
  return nextSel;
}
