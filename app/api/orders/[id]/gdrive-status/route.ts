import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  folderHasFiles,
  parseDriveIdFromUrl,
} from "@/lib/google-drive";
import {
  applyResolvedDriveFolderUrls,
  loadOrderFinalDriveContext,
} from "@/lib/order-gdrive";

// ---------------------------------------------------------------------------
// Server-side TTL cache for Drive status results.
// Module-level — survives across requests on the same warm serverless instance,
// cutting Drive API calls significantly during active board sessions.
// The client-side statusCache in use-gdrive-folder-has-files.ts already
// deduplicates per page session; this layer saves calls on the server.
// ---------------------------------------------------------------------------
const DRIVE_STATUS_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CachedStatus = {
  data: Record<string, unknown>;
  expiresAt: number;
};

const driveStatusCache = new Map<string, CachedStatus>();

function getCachedDriveStatus(key: string): Record<string, unknown> | null {
  const entry = driveStatusCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    driveStatusCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedDriveStatus(key: string, data: Record<string, unknown>) {
  driveStatusCache.set(key, { data, expiresAt: Date.now() + DRIVE_STATUS_TTL_MS });
}

/** Call this when an order's Drive folder changes (save, column move). */
export function invalidateDriveStatusCache(tenantId: string, orderId: string) {
  driveStatusCache.delete(`${tenantId}:${orderId}`);
}

/**
 * GET — whether the order's Final production Drive folder has files / a PDF.
 * Resolves Final by folder name (never treats the designer folder as Final).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: orderId } = await params;
  const bust = new URL(request.url).searchParams.get("refresh") === "1";

  // Serve from server-side TTL cache when available (saves Drive API calls on
  // repeat loads of the same order card during an active board session).
  // Explicit refreshes (bust=true) evict the cache and re-fetch from Drive.
  const cacheKey = `${ctx.tenant.id}:${orderId}`;
  if (bust) driveStatusCache.delete(cacheKey);
  const cached = getCachedDriveStatus(cacheKey);
  if (cached) return NextResponse.json(cached);

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
      hasFinalPdf: false,
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
        hasFinalPdf: false,
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
    const needPersistFinal =
      Boolean(resolvedFinalId) && resolvedFinalId !== storedArtId;
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

    // Run all folder checks in a single parallel batch — including the
    // "directOnly" designer-folder fallback that used to fire sequentially
    // after the batch when hasFinalPdf was false. Including it upfront costs
    // one extra Drive call on orders that already have a Final PDF, but
    // eliminates a full sequential Drive RTT on orders that don't.
    const emptyResult = { hasFiles: false, fileCount: 0, hasPdf: false };
    const [designerResult, jobRootResult, ...finalResults] = await Promise.all([
      designerCheckId
        ? folderHasFiles(settings, designerCheckId, {
            excludeChildIds: resolved.finalIds,
            skipFinalProdChildren: true,
          })
        : Promise.resolve(emptyResult),
      // directOnly check on the designer folder (the job-root fallback).
      designerCheckId
        ? folderHasFiles(settings, designerCheckId, {
            excludeChildIds: resolved.finalIds,
            skipFinalProdChildren: true,
            directOnly: true,
          })
        : Promise.resolve(emptyResult),
      ...resolved.finalIds.map((folderId) =>
        folderHasFiles(settings, folderId)
      ),
    ]);

    let hasFiles = false;
    let fileCount = 0;
    let hasFinalPdf = false;
    for (const result of finalResults) {
      hasFiles = hasFiles || result.hasFiles;
      hasFinalPdf = hasFinalPdf || result.hasPdf;
      fileCount += result.fileCount;
    }
    // No Final PDF in Final folders — a PDF sitting directly in the job folder
    // counts as the production file (jobRootResult already computed in parallel).
    if (!hasFinalPdf && jobRootResult.hasPdf) {
      hasFiles = true;
      hasFinalPdf = true;
      fileCount += jobRootResult.fileCount;
    }
    const hasPdf = hasFinalPdf || designerResult.hasPdf;

    if (hasFinalPdf && resolved.finalIds.length > 0) {
      try {
        after(() => {
          void import("@/lib/approval-layer-previews")
            .then(({ refreshProofsIfDrivePdfChanged }) =>
              refreshProofsIfDrivePdfChanged(
                {
                  id: order.id,
                  title: String(order.title ?? ""),
                  tenant_id: ctx.tenant.id,
                  specs: (order.specs ?? {}) as never,
                },
                settings,
                resolved.finalIds
              )
            )
            .catch((err) =>
              console.warn(
                "[gdrive-status] proof refresh failed:",
                err instanceof Error ? err.message : err
              )
            );
        });
      } catch {
        // after() is not available outside a request
      }
    }

    const responseData = {
      hasFiles,
      hasDesignerFiles: designerResult.hasFiles,
      fileCount,
      hasPdf,
      hasFinalPdf,
      configured: true,
      folderId: resolved.finalIds[0] ?? null,
      designerUrl: resolved.designerUrl,
      finalUrl: resolved.finalUrl,
    };
    setCachedDriveStatus(cacheKey, responseData);
    return NextResponse.json(responseData);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gdrive-status]", message);
    return NextResponse.json(
      {
        hasFiles: false,
        hasDesignerFiles: false,
        fileCount: 0,
        hasPdf: false,
        hasFinalPdf: false,
        configured: true,
        folderId: seedIds[0] ?? null,
        error: message,
      },
      { status: 200 }
    );
  }
}
