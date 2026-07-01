import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { seedDefaultTags } from "@/lib/tags";
import { TagsManager } from "./tags-manager";
import type { Tag } from "@/lib/types";

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

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Tags</h1>
      <p className="mb-5 text-sm text-slate-500">
        Organize orders by type or workflow tag.
      </p>
      <TagsManager initialTags={(data ?? []) as Tag[]} />
    </div>
  );
}
