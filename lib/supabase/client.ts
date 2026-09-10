"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isInvalidRefreshTokenError } from "@/lib/supabase/invalid-refresh";

type BrowserClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserClient | null = null;
let recovering = false;

/**
 * One browser client per tab. Multiple clients race-rotate the same refresh
 * token and produce "Invalid Refresh Token: Refresh Token Not Found".
 */
export function createClient() {
  if (browserClient) return browserClient;

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  if (!recovering) {
    recovering = true;
    void (async () => {
      const { error } = await browserClient!.auth.getUser();
      if (isInvalidRefreshTokenError(error)) {
        await browserClient!.auth.signOut({ scope: "local" });
      }
    })();
  }

  return browserClient;
}
