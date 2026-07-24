import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { seedDefaultTags } from "@/lib/tags";
import { listTimeChips } from "@/lib/time-chips.server";
import { TagsSettingsClient } from "./tags-settings-client";
import type { BoardColumn, Tag } from "@/lib/types";
import type { TimeChip } from "@/lib/time-chips";

export default async function TagsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let { data } = await supabase
    .from("tags")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  if (!data?.length) {
    await seedDefaultTags(supabase, ctx.tenant.id);
    const res = await supabase
      .from("tags")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true });
    data = res.data;
  }

  let timeChips: TimeChip[] = [];
  try {
    timeChips = await listTimeChips(supabase, ctx.tenant.id);
  } catch {
    // Table may not exist until migration 0060 is applied.
    timeChips = [];
  }

  const { data: columns } = await supabase
    .from("board_columns")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Tags</h1>
      <p className="mb-5 text-sm text-slate-500">
        Color tags for orders, and time chips shown on board cards.
      </p>
      <TagsSettingsClient
        initialTags={(data ?? []) as Tag[]}
        initialTimeChips={timeChips}
        columns={(columns ?? []) as BoardColumn[]}
      />
    </div>
  );
}
