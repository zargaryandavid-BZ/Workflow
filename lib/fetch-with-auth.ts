"use client";

import { createClient } from "@/lib/supabase/client";
import { isInvalidRefreshTokenError } from "@/lib/supabase/invalid-refresh";

let refreshPromise: Promise<boolean> | null = null;

/**
 * Single-flight session refresh so parallel board column fetches don't
 * race-rotate the Supabase refresh token when the access token has expired.
 */
async function refreshAuthOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.refresh_token) {
        await supabase.auth.signOut({ scope: "local" });
        return false;
      }
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        if (isInvalidRefreshTokenError(error)) {
          await supabase.auth.signOut({ scope: "local" });
        }
        return false;
      }
      return true;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Turbopack can return an HTML 404 for a real /api or /settings route while
 * compiling (or after a stale .next cache). Real API 404s are JSON.
 */
export function isStaleNext404(res: Response): boolean {
  if (res.status !== 404) return false;
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("text/html");
}

/** One delayed retry when Next served an HTML 404 instead of the route. */
export async function fetchRetryingStale404(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (!isStaleNext404(res)) return res;
  await new Promise((r) => setTimeout(r, 700));
  return fetch(input, init);
}

/**
 * Same as `fetch`, but on 401 refreshes the Supabase session once and retries.
 * If refresh fails, redirects to `/login`.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetchRetryingStale404(input, init);
  if (res.status !== 401) return res;

  const refreshed = await refreshAuthOnce();
  if (!refreshed) {
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
    return res;
  }

  return fetchRetryingStale404(input, init);
}
