import type { SupabaseClient } from "@supabase/supabase-js";
import { remember } from "@/lib/cache";

/**
 * Short-TTL cache for the tiny `profiles` table (team members — ~20 rows).
 *
 * The board enrichment used to query `profiles` by id on EVERY card refresh,
 * which made this 20-row static table the single most-called query in the whole
 * database (tens of millions of calls). Names change rarely, so we cache the
 * full id→full_name map per serverless instance for a minute and resolve lookups
 * locally. Any id not in the cache (e.g. a brand-new teammate) is fetched
 * directly, so a name is never shown blank — correctness is preserved, we just
 * stop hammering the DB for a list that almost never changes.
 */

type ProfileRow = { id: string; full_name: string | null };

// Staff names change very rarely, so a 5-minute cache is safe and cuts the
// number of times this 20-row list is re-read from the database (it was one of
// the single most-called queries in the whole system). A brand-new teammate's
// name still appears within 5 minutes, and any id missing from the cache is
// still fetched directly on demand (see getCachedProfilesByIds), so names are
// never shown blank.
const TTL_MS = 5 * 60_000;
// Shared cache key + TTL (seconds). The Redis layer makes the 5-minute cache
// SHARED across all serverless instances — a per-process cache barely helped
// because Vercel spins up many short-lived instances, so this list was still
// re-read from the DB tens of millions of times. Now one instance warms it and
// the rest read it from memory.
const REDIS_KEY = "wf:profiles:fullnames:v1";
const REDIS_TTL_SECONDS = 300;

let cache: { at: number; byId: Map<string, string | null> } | null = null;

async function warmAllProfiles(supabase: SupabaseClient): Promise<void> {
  try {
    const rows = await remember<ProfileRow[]>(REDIS_KEY, REDIS_TTL_SECONDS, async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name");
      // Throw on error so a failed read is NOT cached; the stale local cache is
      // kept and missing ids still fall back to a direct fetch.
      if (error) throw new Error(error.message);
      return (data ?? []) as ProfileRow[];
    });
    cache = {
      at: Date.now(),
      byId: new Map(rows.map((p: ProfileRow) => [p.id, p.full_name ?? null])),
    };
  } catch {
    // leave stale/empty cache; callers fall back to direct fetch
  }
}

/**
 * Resolve profile names for the given ids, same shape the old inline query
 * returned (`{ data: ProfileRow[] }`) so callers stay unchanged.
 */
export async function getCachedProfilesByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ data: ProfileRow[] }> {
  if (ids.length === 0) return { data: [] };

  if (!cache || Date.now() - cache.at > TTL_MS) {
    await warmAllProfiles(supabase);
  }

  const rows: ProfileRow[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    if (cache && cache.byId.has(id)) {
      rows.push({ id, full_name: cache.byId.get(id) ?? null });
    } else {
      missing.push(id);
    }
  }

  // Unknown ids (not yet cached) — fetch directly so names never go blank, and
  // warm them into the cache for the rest of the TTL window.
  if (missing.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", missing);
    for (const p of (data ?? []) as ProfileRow[]) {
      rows.push(p);
      if (cache) cache.byId.set(p.id, p.full_name ?? null);
    }
  }

  return { data: rows };
}
