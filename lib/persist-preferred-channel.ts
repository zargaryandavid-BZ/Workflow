"use client";

import type { Customer, PreferredChannel } from "@/lib/types";

export type SavePreferredChannelResult =
  | { ok: true; customer: Customer | null }
  | { ok: false; error: string };

/**
 * Save the customer's default notification channel (Email / SMS / Both).
 * Awaited — callers show "Saved" or the real error. Before 2026-10-20 this was
 * fire-and-forget on every chip click and failures were swallowed.
 */
export async function saveCustomerPreferredChannel(
  customerId: string | null | undefined,
  channel: PreferredChannel
): Promise<SavePreferredChannelResult> {
  if (!customerId) {
    return {
      ok: false,
      error: "This card is not linked to a saved customer yet.",
    };
  }
  try {
    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_channel: channel }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      customer?: Customer;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: json.error ?? "Could not save the default." };
    }
    return { ok: true, customer: json.customer ?? null };
  } catch {
    return { ok: false, error: "Could not save the default (network error)." };
  }
}
