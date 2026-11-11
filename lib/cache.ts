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

// Circuit breaker: when Upstash refuses (e.g. "ERR max requests limit
// exceeded" on the free plan) every cache call still cost a full network round
// trip before falling through — slower than having no cache at all. After a
// failure, skip Redis on this instance for a while and use the small
// in-memory fallback below instead.
const BREAKER_LIMIT_MS = 10 * 60 * 1000; // quota / auth refusals
const BREAKER_ERROR_MS = 30 * 1000; // transient errors (timeouts, 5xx)
let redisDownUntil = 0;

function noteRedisFailure(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const hard = /max requests limit|limit exceeded|unauthori[sz]ed|WRONGPASS|NOAUTH/i.test(msg);
  redisDownUntil = Date.now() + (hard ? BREAKER_LIMIT_MS : BREAKER_ERROR_MS);
}

function getRedis(): Redis | null {
  if (client === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    client = url && token ? new Redis({ url, token }) : null;
  }
  if (client && Date.now() < redisDownUntil) return null;
  return client;
}

// In-memory fallback (per serverless instance) used ONLY while Redis is
// unavailable. TTL is capped short because a write on another instance can't
// clear this copy, so stale answers live at most MEM_TTL_CAP_SECONDS.
const MEM_TTL_CAP_SECONDS = 60;
const MEM_MAX_ENTRIES = 2000;
const mem = new Map<string, { v: unknown; exp: number }>();

function memGet<T>(key: string): T | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) {
    mem.delete(key);
    return null;
  }
  return hit.v as T;
}

function memSet(key: string, value: unknown, ttlSeconds: number): void {
  if (value === null || value === undefined) return;
  if (mem.size >= MEM_MAX_ENTRIES) {
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
  const ttl = Math.max(1, Math.min(ttlSeconds, MEM_TTL_CAP_SECONDS));
  mem.set(key, { v: value, exp: Date.now() + ttl * 1000 });
}

/** Whether Redis is configured but temporarily skipped (test/diagnostics). */
export function cacheBreakerOpen(): boolean {
  return Date.now() < redisDownUntil;
}

/** True when a cache backend is configured (for optional callers). */
export function cacheEnabled(): boolean {
  if (client === undefined) getRedis();
  return client !== null && client !== undefined;
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
  if (!redis) {
    if (!cacheBreakerOpen()) return fetchFresh(); // no cache configured
    const local = memGet<T>(key);
    if (local !== null) return local;
    const fresh = await fetchFresh();
    memSet(key, fresh, ttlSeconds);
    return fresh;
  }

  try {
    const hit = await redis.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch (err) {
    noteRedisFailure(err);
    // cache read failed — fall through to the database
  }

  const fresh = await fetchFresh();

  if (cacheBreakerOpen()) {
    memSet(key, fresh, ttlSeconds);
    return fresh;
  }
  try {
    // Don't cache empty/nullish results — let the next call retry the source.
    if (fresh !== null && fresh !== undefined) {
      await redis.set(key, fresh, { ex: ttlSeconds });
    }
  } catch (err) {
    noteRedisFailure(err);
    memSet(key, fresh, ttlSeconds);
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
  if (!redis && !cacheBreakerOpen()) return fetchMissing(keys);

  const result: Record<string, T> = {};
  let missing: string[] = keys;
  if (!redis) {
    missing = [];
    for (const k of keys) {
      const v = memGet<T>(k);
      if (v !== null) result[k] = v;
      else missing.push(k);
    }
  } else {
    try {
      const hits = (await redis.mget<T[]>(...keys)) ?? [];
      missing = [];
      keys.forEach((k, i) => {
        const v = hits[i];
        if (v !== null && v !== undefined) result[k] = v as T;
        else missing.push(k);
      });
    } catch (err) {
      noteRedisFailure(err);
      missing = keys; // cache read failed — treat everything as a miss
    }
  }

  if (missing.length > 0) {
    const fresh = await fetchMissing(missing);
    Object.assign(result, fresh);
    if (!redis || cacheBreakerOpen()) {
      for (const k of missing) memSet(k, fresh[k], ttlSeconds);
      return result;
    }
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
    } catch (err) {
      noteRedisFailure(err);
      for (const k of missing) memSet(k, fresh[k], ttlSeconds);
    }
  }
  return result;
}

/** Drop one or more cache keys (call after a write that changes them). */
export async function cacheInvalidate(key: string | string[]): Promise<void> {
  const keys = Array.isArray(key) ? key : [key];
  if (keys.length === 0) return;
  for (const k of keys) mem.delete(k);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    noteRedisFailure(err);
  }
}

/** Read one key; null on miss or any cache error. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return cacheBreakerOpen() ? memGet<T>(key) : null;
  try {
    const v = await redis.get<T>(key);
    return v ?? null;
  } catch (err) {
    noteRedisFailure(err);
    return memGet<T>(key);
  }
}

/** Write one key with a TTL. Best-effort; nullish values are never stored. */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (value === null || value === undefined) return;
  const redis = getRedis();
  if (!redis) {
    if (cacheBreakerOpen()) memSet(key, value, ttlSeconds);
    return;
  }
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    noteRedisFailure(err);
    memSet(key, value, ttlSeconds);
  }
}
