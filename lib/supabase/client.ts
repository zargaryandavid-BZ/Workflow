"use client";

import { createBrowserClient } from "@supabase/ssr";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserClient | null = null;

/**
 * One browser client per tab. Multiple clients race-rotate the same refresh
 * token and produce "Invalid Refresh Token: Refresh Token Not Found".
 *
 * Do not call getUser() here — createBrowserClient already recovers the
 * session. A second refresh uses the old token and looks like a missing RT.
 */
export function createClient(_opts?: { skipSessionRecover?: boolean }) {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return browserClient;
}
