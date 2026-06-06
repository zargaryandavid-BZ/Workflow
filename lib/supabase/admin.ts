import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS. Server-only.
 * Use ONLY in route handlers / server actions where tenant access has
 * already been verified, or for public token-validated flows (approvals).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
