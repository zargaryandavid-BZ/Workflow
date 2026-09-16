import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { folderHasFiles, parseDriveIdFromUrl } from "@/lib/google-drive";
import {
  applyResolvedDriveFolderUrls,
  loadOrderFinalDriveContext,
} from "@/lib/order-gdrive";

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
  const loaded = await loadOrderFinalDriveContext(
    supabase,
    ctx.tenant.id,
    orderId
  );

  if (loaded.kind === "not_found") {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (loaded.kind === "not_configured") {
    return NextResponse.json({
      hasFiles: false,
      hasDesignerFiles: false,
      fileCount: 0,
      hasPdf: false,
      configured: false,
    });
  }
  if (loaded.kind === "error") {
    return NextResponse.json({ error: loaded.message }, { status: 500 });
  }

  const { order, settings, artworkUrl, seedIds, resolved, resolveError } = loaded;

  if (!resolved) {
    if (resolveError) {
      console.error("[gdrive-status]", resolveError);
    }
    return NextResponse.json(
      {
        hasFiles: false,
        hasDesignerFiles: false,
        fileCount: 0,
        hasPdf: false,
        configured: true,
        folderId: seedIds[0] ?? null,
        ...(resolveError ? { error: resolveError } : {}),
      },
      { status: 200 }
    );
  }

  try {
    const specs = order.specs;
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

    const designerCheckId =
      resolved.designerId && !resolved.finalIds.includes(resolved.designerId)
        ? resolved.designerId
        : storedDesignerId && !resolved.finalIds.includes(storedDesignerId)
          ? storedDesignerId
          : null;

    const [designerResult, ...finalResults] = await Promise.all([
      designerCheckId
        ? folderHasFiles(settings, designerCheckId, {
            excludeChildIds: resolved.finalIds,
            skipFinalProdChildren: true,
          })
        : Promise.resolve({ hasFiles: false, fileCount: 0, hasPdf: false }),
      ...resolved.finalIds.map((folderId) =>
        folderHasFiles(settings, folderId)
      ),
    ]);

    let hasFiles = false;
    let fileCount = 0;
    let hasPdf = false;
    for (const result of finalResults) {
      hasFiles = hasFiles || result.hasFiles;
      hasPdf = hasPdf || result.hasPdf;
      fileCount += result.fileCount;
    }
    hasPdf = hasPdf || designerResult.hasPdf;

    return NextResponse.json({
      hasFiles,
      hasDesignerFiles: designerResult.hasFiles,
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
        hasDesignerFiles: false,
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
