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

/**
 * Batch version of `remember` for many keys at once (e.g. per-order data on a
 * board refresh). Reads all keys from Redis in one round-trip (mget), computes
 * only the misses via `fetchMissing`, writes them back in one pipeline, and
 * returns a `{ key: value }` map. Best-effort: on any cache error it falls
 * through to `fetchMissing` for everything, so behavior is identical to no
 * cache. `fetchMissing` may throw (e.g. a DB error) — callers handle that.
 */
export async function rememberMany<T>(
  keys: string[],
  ttlSeconds: number,
  fetchMissing: (missingKeys: string[]) => Promise<Record<string, T>>
): Promise<Record<string, T>> {
  if (keys.length === 0) return {};
  const redis = getRedis();
  if (!redis) return fetchMissing(keys);

  const result: Record<string, T> = {};
  let missing: string[] = keys;
  try {
    const hits = (await redis.mget<T[]>(...keys)) ?? [];
    missing = [];
    keys.forEach((k, i) => {
      const v = hits[i];
      if (v !== null && v !== undefined) result[k] = v as T;
      else missing.push(k);
    });
  } catch {
    missing = keys; // cache read failed — treat everything as a miss
  }

  if (missing.length > 0) {
    const fresh = await fetchMissing(missing);
    Object.assign(result, fresh);
    try {
      const pipe = redis.pipeline();
      let wrote = false;
      for (const k of missing) {
        const v = fresh[k];
        if (v !== null && v !== undefined) {
          pipe.set(k, v, { ex: ttlSeconds });
          wrote = true;
        }
      }
      if (wrote) await pipe.exec();
    } catch {
      // cache write failed — not fatal
    }
  }
  return result;
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
