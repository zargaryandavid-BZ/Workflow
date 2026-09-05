import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { ARTWORK_FIELD_NAME } from "@/lib/constants";
import {
  ensureGdriveSettings,
  isGdriveConfigured,
} from "@/lib/gdrive-settings";
import { folderHasFiles, parseDriveIdFromUrl } from "@/lib/google-drive";
import { proofsDriveClient } from "@/lib/gdrive-proofs";
import {
  orderFolderNeedles,
  resolveOrderDriveFolders,
  seedDriveIdsFromOrder,
} from "@/lib/resolve-order-drive-folders";
import { applyResolvedDriveFolderUrls } from "@/lib/order-gdrive";

/**
 * GET — whether the order's Final production Drive folder has files / a PDF.
 * Resolves Final by folder name (never treats the designer folder as Final).
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
    .select("id, title, specs")
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
  let artworkUrl = "";
  if (fieldId) {
    const { data: valueRow } = await supabase
      .from("custom_field_values")
      .select("value")
      .eq("order_id", orderId)
      .eq("custom_field_id", fieldId)
      .maybeSingle();
    artworkUrl =
      typeof (valueRow as { value?: unknown } | null)?.value === "string"
        ? String((valueRow as { value: string }).value).trim()
        : "";
  }

  const specs =
    order.specs && typeof order.specs === "object" && !Array.isArray(order.specs)
      ? (order.specs as Record<string, unknown>)
      : {};
  const seedIds = seedDriveIdsFromOrder({
    specs,
    artworkUrl: artworkUrl || null,
  });

  if (seedIds.length === 0) {
    return NextResponse.json({
      hasFiles: false,
      fileCount: 0,
      hasPdf: false,
      configured: true,
      folderId: null,
    });
  }

  try {
    const proofs = proofsDriveClient(settings);
    const resolved = await resolveOrderDriveFolders(proofs, {
      seedIds,
      extraRootId: settings.final_root_folder_id?.trim() || null,
      excludeParentIds: [
        settings.root_folder_id?.trim() || "",
        settings.shared_drive_id?.trim() || "",
      ].filter(Boolean),
      orderNeedles: orderFolderNeedles({
        title: String(order.title ?? ""),
        specs,
      }),
    });

    const storedDesigner =
      typeof specs.design_task === "string" ? specs.design_task.trim() : "";
    const storedDesignerId = storedDesigner
      ? parseDriveIdFromUrl(storedDesigner)
      : null;
    const storedArtId = artworkUrl ? parseDriveIdFromUrl(artworkUrl) : null;
    const resolvedFinalId = resolved.finalUrl
      ? parseDriveIdFromUrl(resolved.finalUrl)
      : null;
    const resolvedDesignerId = resolved.designerUrl
      ? parseDriveIdFromUrl(resolved.designerUrl)
      : null;
    const needPersistFinal = Boolean(resolvedFinalId) && resolvedFinalId !== storedArtId;
    const needPersistDesigner =
      Boolean(resolvedDesignerId) &&
      resolved.designerFromSeed &&
      resolvedDesignerId !== storedDesignerId;
    if (needPersistFinal || needPersistDesigner) {
      await applyResolvedDriveFolderUrls(
        supabase,
        ctx.tenant.id,
        orderId,
        {
          designerUrl: needPersistDesigner ? resolved.designerUrl : null,
          finalUrl: needPersistFinal ? resolved.finalUrl : null,
        }
      );
    }

    let hasFiles = false;
    let fileCount = 0;
    let hasPdf = false;
    for (const folderId of resolved.finalIds) {
      const result = await folderHasFiles(settings, folderId);
      hasFiles = hasFiles || result.hasFiles;
      hasPdf = hasPdf || result.hasPdf;
      fileCount += result.fileCount;
      if (hasPdf && hasFiles) break;
    }

    return NextResponse.json({
      hasFiles,
      fileCount,
      hasPdf,
      configured: true,
      folderId: resolved.finalIds[0] ?? null,
      designerUrl: resolved.designerUrl,
      finalUrl: resolved.finalUrl,
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
        folderId: seedIds[0] ?? null,
        error: message,
      },
      { status: 200 }
    );
  }
}
