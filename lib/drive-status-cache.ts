// Shared, cross-server cache for the per-order Google Drive checks the board
// runs on every card (gdrive-status, pdf-check). Each server instance keeps a
// fast in-memory copy (L1), backed by a shared Supabase table (L2, table
// public.drive_status_cache) so a cache hit on one server is a cache hit
// everywhere — Vercel serverless instances don't share memory, so an
// in-memory-only cache used to miss constantly across different instances.
import { createAdminClient } from "@/lib/supabase/admin";

type MemoryEntry = { data: unknown; expiresAt: number };
const memoryCache = new Map<string, MemoryEntry>();

export async function getSharedDriveCache<T>(key: string): Promise<T | null> {
  const local = memoryCache.get(key);
  if (local) {
    if (local.expiresAt > Date.now()) return local.data as T;
    memoryCache.delete(key);
  }

  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("drive_status_cache")
      .select("data, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (data && new Date(data.expires_at as string).getTime() > Date.now()) {
      memoryCache.set(key, {
        data: data.data,
        expiresAt: new Date(data.expires_at as string).getTime(),
      });
      return data.data as T;
    }
  } catch {
    // Best-effort — a cache miss just means the caller recomputes from Drive.
  }
  return null;
}

export async function setSharedDriveCache(
  key: string,
  data: unknown,
  ttlMs: number,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  memoryCache.set(key, { data, expiresAt });
  try {
    const admin = createAdminClient();
    await admin.from("drive_status_cache").upsert({
      cache_key: key,
      data: data as Record<string, unknown>,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } catch {
    // Best-effort — the in-memory L1 above still serves this instance.
  }
}

export function invalidateSharedDriveCache(key: string): void {
  memoryCache.delete(key);
  void (async () => {
    try {
      const admin = createAdminClient();
      await admin.from("drive_status_cache").delete().eq("cache_key", key);
    } catch {
      /* best-effort */
    }
  })();
}
