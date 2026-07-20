import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildGdriveSettingsUpdate,
  ensureGdriveSettings,
  toPublicGdriveSettings,
  type GdriveSettingsPatch,
} from "@/lib/gdrive-settings";
import { testGdriveConnection } from "@/lib/google-drive";
import type { GdriveLinkTarget } from "@/lib/types";

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

export async function GET() {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const supabase = await createClient();
  try {
    const settings = await ensureGdriveSettings(supabase, ctx.tenant.id);
    return NextResponse.json({ settings: toPublicGdriveSettings(settings) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load settings";
    return NextResponse.json(
      { error: formatLoadError(message) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as GdriveSettingsPatch & {
    test?: boolean;
  };

  if (body.link_target !== undefined) {
    const t = body.link_target as GdriveLinkTarget;
    if (t !== "customer" && t !== "order" && t !== "final") {
      return NextResponse.json(
        { error: "link_target must be customer, order, or final" },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();
  try {
    const existing = await ensureGdriveSettings(supabase, ctx.tenant.id);
    const updates = buildGdriveSettingsUpdate(existing, body);

    if (Object.keys(updates).length <= 1 && !body.test) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    if (Object.keys(updates).length > 1) {
      const { error } = await supabase
        .from("gdrive_settings")
        .update(updates)
        .eq("tenant_id", ctx.tenant.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    const refreshed = await ensureGdriveSettings(supabase, ctx.tenant.id);

    let testResult: { ok: boolean; folderName?: string; error?: string } | undefined;
    if (body.test) {
      const result = await testGdriveConnection(refreshed);
      testResult = result.ok
        ? { ok: true, folderName: result.folderName }
        : { ok: false, error: result.error };
    }

    return NextResponse.json({
      settings: toPublicGdriveSettings(refreshed),
      test: testResult,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save settings";
    return NextResponse.json(
      { error: formatLoadError(message) },
      { status: 500 }
    );
  }
}
