import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Shared "remember the answer" cache (Upstash Redis, serverless-friendly over
 * HTTP). This is the memory layer that lets hot, rarely-changing lookups be
 * served from memory instead of re-querying the database on every request —
 * shared across ALL serverless instances, unlike a per-process in-memory cache.
 *
 * SAFETY: the cache is strictly best-effort. If the Upstash env vars are not
 * set, or Redis is unreachable, or a read/write errors, every helper falls
 * straight through to the live database. Caching can never break a request or
 * change what data is returned — only how fast it comes back.
 */

let client: Redis | null | undefined;

function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/** True when a cache backend is configured (for optional callers). */
export function cacheEnabled(): boolean {
  return getRedis() !== null;
}

/**
 * Return the cached value for `key`, or compute it with `fetchFresh`, store it
 * for `ttlSeconds`, and return it. On any cache error it simply returns the
 * fresh value — identical behavior to not having a cache at all.
 */
export async function remember<T>(
  key: string,
  ttlSeconds: number,
  fetchFresh: () => Promise<T>
): Promise<T> {
  const redis = getRedis();
  if (!redis) return fetchFresh();

  try {
    const hit = await redis.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch {
    // cache read failed — fall through to the database
  }

  const fresh = await fetchFresh();

  try {
    // Don't cache empty/nullish results — let the next call retry the source.
    if (fresh !== null && fresh !== undefined) {
      await redis.set(key, fresh, { ex: ttlSeconds });
    }
  } catch {
    // cache write failed — not fatal
  }
  return fresh;
}

/** Drop one or more cache keys (call after a write that changes them). */
export async function cacheInvalidate(key: string | string[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const keys = Array.isArray(key) ? key : [key];
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch {
    // best-effort
  }
}
