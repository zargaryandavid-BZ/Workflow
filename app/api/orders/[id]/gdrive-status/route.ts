import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ARTWORK_FIELD_NAME } from "@/lib/constants";
import {
  ensureGdriveSettings,
  isGdriveConfigured,
} from "@/lib/gdrive-settings";
import {
  folderHasFiles,
  parseDriveIdFromUrl,
} from "@/lib/google-drive";

/**
 * GET — whether the order's Artwork / Final production Drive folder has files
 * (directly, or one level down in a child folder such as Final production).
 * Uses the URL saved on the Artwork (GDrive link) custom field.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  let settings;
  try {
    settings = await ensureGdriveSettings(supabase, ctx.tenant.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("gdrive_settings") ||
      message.includes("schema cache") ||
      message.includes("does not exist")
    ) {
      return NextResponse.json({
        hasFiles: false,
        fileCount: 0,
        hasPdf: false,
        configured: false,
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!settings.enabled || !isGdriveConfigured(settings)) {
    return NextResponse.json({
      hasFiles: false,
      fileCount: 0,
      hasPdf: false,
      configured: false,
    });
  }

  const { data: field } = await supabase
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", ctx.tenant.id)
    .ilike("name", ARTWORK_FIELD_NAME)
    .maybeSingle();

  const fieldId = (field as { id: string } | null)?.id;
  if (!fieldId) {
    return NextResponse.json({
      hasFiles: false,
      fileCount: 0,
      hasPdf: false,
      configured: true,
      error: "Artwork field not found",
    });
  }

  const { data: valueRow } = await supabase
    .from("custom_field_values")
    .select("value")
    .eq("order_id", orderId)
    .eq("custom_field_id", fieldId)
    .maybeSingle();

  const url =
    typeof (valueRow as { value?: unknown } | null)?.value === "string"
      ? String((valueRow as { value: string }).value).trim()
      : "";

  if (!url) {
    return NextResponse.json({
      hasFiles: false,
      fileCount: 0,
      hasPdf: false,
      configured: true,
      folderId: null,
    });
  }

  const folderId = parseDriveIdFromUrl(url);
  if (!folderId) {
    return NextResponse.json({
      hasFiles: false,
      fileCount: 0,
      hasPdf: false,
      configured: true,
      folderId: null,
      error: "Could not parse Drive folder id from Artwork URL",
    });
  }

  try {
    const result = await folderHasFiles(settings, folderId);
    return NextResponse.json({
      hasFiles: result.hasFiles,
      fileCount: result.fileCount,
      hasPdf: result.hasPdf,
      configured: true,
      folderId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gdrive-status]", message);
    return NextResponse.json(
      {
        hasFiles: false,
        fileCount: 0,
        hasPdf: false,
        configured: true,
        folderId,
        error: message,
      },
      { status: 200 }
    );
  }
}
