import type { SupabaseClient } from "@supabase/supabase-js";

/** How long a crashed ingest may hold the lock before another request may steal it. */
export const WEBHOOK_INGEST_LOCK_STALE_MS = 10 * 60 * 1000;
/** Max time a concurrent webhook waits for the first ingest to finish. */
export const WEBHOOK_INGEST_LOCK_WAIT_MS = 120 * 1000;
const DEFAULT_POLL_MS = 100;

export type WebhookOrderLockOptions = {
  waitMs?: number;
  staleMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function normalizeWebhookIngestOrderKey(orderNumber: string): string {
  return orderNumber.trim().toLowerCase();
}

export function isPgUniqueViolation(
  error: { code?: string | null } | null | undefined
): boolean {
  return error?.code === "23505";
}

export function isUndefinedTableError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /webhook_order_ingest_locks/i.test(error.message ?? "");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize CRM/portal v1 ingest for one tenant + order_number so two POSTs
 * at the same time cannot both see "no cards" and insert duplicates.
 * A later re-fire (after the lock is released) still updates existing cards.
 */
export async function withWebhookOrderIngestLock<T>(
  client: SupabaseClient,
  tenantId: string,
  orderNumber: string,
  fn: () => Promise<T>,
  options: WebhookOrderLockOptions = {}
): Promise<T> {
  const orderKey = normalizeWebhookIngestOrderKey(orderNumber);
  if (!orderKey) return fn();

  const waitMs = options.waitMs ?? WEBHOOK_INGEST_LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? WEBHOOK_INGEST_LOCK_STALE_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = now() + waitMs;

  while (true) {
    const staleBefore = new Date(now() - staleMs).toISOString();
    const staleDelete = await client
      .from("webhook_order_ingest_locks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("order_key", orderKey)
      .lt("claimed_at", staleBefore);
    if (staleDelete.error && isUndefinedTableError(staleDelete.error)) {
      console.error(
        "[webhook/orders] ingest lock table missing; proceeding without lock"
      );
      return fn();
    }

    const { error } = await client.from("webhook_order_ingest_locks").insert({
      tenant_id: tenantId,
      order_key: orderKey,
    });
    if (!error) {
      try {
        return await fn();
      } finally {
        const released = await client
          .from("webhook_order_ingest_locks")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("order_key", orderKey);
        if (released.error) {
          console.error(
            "[webhook/orders] ingest lock release failed:",
            released.error.message
          );
        }
      }
    }
    if (isUndefinedTableError(error)) {
      console.error(
        "[webhook/orders] ingest lock table missing; proceeding without lock"
      );
      return fn();
    }
    if (!isPgUniqueViolation(error)) {
      throw new Error(error.message);
    }
    if (now() >= deadline) {
      throw new Error(
        `Timed out waiting for webhook ingest lock (${orderNumber})`
      );
    }
    await sleep(pollMs);
  }
}
