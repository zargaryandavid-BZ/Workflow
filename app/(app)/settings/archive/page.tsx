import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ArchiveSettingsManager } from "./archive-settings-manager";
import type { BoardColumn } from "@/lib/types";
import type { ColumnArchiveRow } from "@/app/api/archives/route";

export default async function ArchiveSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) return null;
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  const [{ data: columns }, { data: archives, error: archivesError }] =
    await Promise.all([
      supabase
        .from("board_columns")
        .select("*")
        .eq("tenant_id", ctx.tenant.id)
        .order("position", { ascending: true }),
      supabase
        .from("column_archives")
        .select("*")
        .eq("tenant_id", ctx.tenant.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const migrationRequired = Boolean(
    archivesError?.message?.includes("column_archives")
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-800">Archive</h1>
      <p className="mb-5 text-sm text-slate-500">
        Snapshot a board column (orders, history, and files) into Supabase
        Storage. Archives stay available here for download later.
      </p>
      <ArchiveSettingsManager
        columns={(columns ?? []) as BoardColumn[]}
        initialArchives={
          migrationRequired ? [] : ((archives ?? []) as ColumnArchiveRow[])
        }
        migrationRequired={migrationRequired}
      />
    </div>
  );
}
