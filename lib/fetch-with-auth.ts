"use client";

import { createClient } from "@/lib/supabase/client";

let refreshPromise: Promise<boolean> | null = null;

/**
 * Single-flight session refresh so parallel board column fetches don't
 * race-rotate the Supabase refresh token when the access token has expired.
 */
async function refreshAuthOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.auth.refreshSession();
      return !error && !!data.session;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * Same as `fetch`, but on 401 refreshes the Supabase session once and retries.
 * If refresh fails, redirects to `/login`.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const refreshed = await refreshAuthOnce();
  if (!refreshed) {
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
    return res;
  }

  return fetch(input, init);
}
