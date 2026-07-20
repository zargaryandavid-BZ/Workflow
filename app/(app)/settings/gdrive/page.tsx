import { redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  ensureGdriveSettings,
  toPublicGdriveSettings,
} from "@/lib/gdrive-settings";
import { GdriveSettingsManager } from "./gdrive-settings-manager";

function formatLoadError(message: string): string {
  if (
    message.includes("gdrive_settings") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  ) {
    return "Google Drive settings require migration 0049_gdrive_settings.sql (run supabase db push).";
  }
  return message;
}

export default async function GdriveSettingsPage() {
  const ctx = await getTenantContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "admin") redirect("/board");

  const supabase = await createClient();
  let loadError: string | null = null;
  let settings = null;

  try {
    settings = toPublicGdriveSettings(
      await ensureGdriveSettings(supabase, ctx.tenant.id)
    );
  } catch (err) {
    loadError = formatLoadError(
      err instanceof Error ? err.message : "Could not load Google Drive settings"
    );
  }

  if (!settings) {
    return (
      <div>
        <h1 className="mb-1 text-lg font-semibold text-slate-800">GDrive</h1>
        <p className="mb-6 text-sm text-red-600">{loadError}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-800">GDrive</h1>
      <p className="mb-6 text-sm text-slate-500">
        Auto-create{" "}
        <code className="rounded bg-slate-100 px-1 text-xs">
          26-0098_Customer Name / 26-0098_Final for Prod
        </code>{" "}
        when jobs are created (multi-item:{" "}
        <code className="rounded bg-slate-100 px-1 text-xs">…_1</code>,{" "}
        <code className="rounded bg-slate-100 px-1 text-xs">…_2</code>
        ), and save each card’s own Design files / Artwork link.
      </p>
      <GdriveSettingsManager initialSettings={settings} loadError={loadError} />
    </div>
  );
}
