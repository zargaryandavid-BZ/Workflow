import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { seedDefaultCategories } from "@/lib/categories";
import { CategoriesManager } from "./categories-manager";
import type { Category } from "@/lib/types";

export default async function CategoriesSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let { data } = await supabase
    .from("categories")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  if (!data?.length) {
    await seedDefaultCategories(supabase, ctx.tenant.id);
    const res = await supabase
      .from("categories")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("position", { ascending: true });
    data = res.data;
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Categories</h1>
      <p className="mb-5 text-sm text-slate-500">
        Organize orders by type or workflow category.
      </p>
      <CategoriesManager initialCategories={(data ?? []) as Category[]} />
    </div>
  );
}
