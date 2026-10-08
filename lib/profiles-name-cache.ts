import type { SupabaseClient } from "@supabase/supabase-js";

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

const TTL_MS = 60_000;

let cache: { at: number; byId: Map<string, string | null> } | null = null;

async function warmAllProfiles(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.from("profiles").select("id, full_name");
  if (error) return; // leave stale/empty cache; callers fall back to direct fetch
  cache = {
    at: Date.now(),
    byId: new Map((data ?? []).map((p: ProfileRow) => [p.id, p.full_name ?? null])),
  };
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
