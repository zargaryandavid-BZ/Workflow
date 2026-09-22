import "server-only";

import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cached board config loader (60-second revalidate).
 *
 * These 6 tables (board_columns, custom_fields, tags, memberships,
 * automation_rules, webhook_configs) are tenant-scoped and change
 * infrequently. Wrapping them in unstable_cache means the Next.js
 * data cache serves repeat board loads from a shared in-process store
 * rather than hitting Supabase on every request.
 *
 * Uses createAdminClient() (service role) because unstable_cache
 * functions execute outside the request context where cookies() /
 * createClient() would throw.
 *
 * Call revalidateBoardConfig(tenantId) whenever a column, tag,
 * custom field, automation rule, or webhook config is saved.
 */
export const fetchBoardConfigCached = unstable_cache(
  async (tenantId: string) => {
    const supabase = createAdminClient();
    const [columnsRes, fieldsRes, tagsRes, memberRes, rulesRes, webhookRes] =
      await Promise.all([
        supabase
          .from("board_columns")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("position", { ascending: true }),
        supabase
          .from("custom_fields")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("position", { ascending: true }),
        supabase
          .from("tags")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("position", { ascending: true }),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("tenant_id", tenantId),
        supabase
          .from("automation_rules")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("trigger", "on_enter_column"),
        supabase
          .from("webhook_configs")
          .select("source_styles")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);

    return {
      columns: columnsRes.data ?? [],
      fields: fieldsRes.data ?? [],
      tags: tagsRes.data ?? [],
      members: memberRes.data ?? [],
      rules: rulesRes.data ?? [],
      webhook: webhookRes.data ?? null,
    };
  },
  ["board-config"],
  { revalidate: 60, tags: ["board-config"] }
);
