import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FieldsManager } from "./fields-manager";
import type { CustomField } from "@/lib/types";

export default async function FieldsSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_fields")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("position", { ascending: true });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Custom Fields</h1>
      <p className="mb-5 text-sm text-slate-500">
        Capture print-specific metadata on every job (e.g. Pantone color, bleed,
        finish). These appear on each job&apos;s detail view.
      </p>
      <FieldsManager initialFields={(data ?? []) as CustomField[]} />
    </div>
  );
}
