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
import { cacheInvalidate, swrGet, swrSet } from "@/lib/cache";
import {
  cardImageMissKey,
  cardImageRespKey,
  driveStatusKey,
  pdfCheckRespKey,
} from "@/lib/board-cache-keys";

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

// Shared (Upstash) copy of the same 5-min result so every serverless instance
// benefits — the per-instance Map above only helps the instance that computed it.
// Best-effort: any Redis error behaves exactly like a miss.
const DRIVE_STATUS_FRESH_SECONDS = 5 * 60;

/** Call this when an order's Drive folder changes (save, column move). */
export function invalidateDriveStatusCache(tenantId: string, orderId: string) {
  driveStatusCache.delete(`${tenantId}:${orderId}`);
  void cacheInvalidate([
    driveStatusKey(tenantId, orderId),
    cardImageRespKey(tenantId, orderId),
    pdfCheckRespKey(tenantId, orderId),
  ]);
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
  if (bust) {
    driveStatusCache.delete(cacheKey);
    // A manual Drive refresh also lets the card retry building its picture.
    await cacheInvalidate([
      driveStatusKey(ctx.tenant.id, orderId),
      cardImageMissKey(ctx.tenant.id, orderId),
      cardImageRespKey(ctx.tenant.id, orderId),
      pdfCheckRespKey(ctx.tenant.id, orderId),
    ]);
  }
  const cached = getCachedDriveStatus(cacheKey);
  if (cached) return NextResponse.json(cached);
  if (!bust) {
    // Saved answer → show it now; older than 5 min → re-check Drive in the
    // background so the next open is current (Hayk 2026-11-26).
    const shared = await swrGet<Record<string, unknown>>(
      driveStatusKey(ctx.tenant.id, orderId)
    );
    if (shared) {
      setCachedDriveStatus(cacheKey, shared.value);
      if (shared.ageSeconds > DRIVE_STATUS_FRESH_SECONDS) {
        const tenantId = ctx.tenant.id;
        const bg = await createClient();
        try {
          after(() =>
            computeDriveStatus(bg, tenantId, orderId, cacheKey).catch(() => undefined)
          );
        } catch {
          // after() unavailable outside a request — skip the refresh
        }
      }
      return NextResponse.json(shared.value);
    }
  }

  const supabase = await createClient();
  const res = await computeDriveStatus(supabase, ctx.tenant.id, orderId, cacheKey);
  return NextResponse.json(res.body, { status: res.status });
}

/** Look the order's Drive folders up and save a successful answer. */
async function computeDriveStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  orderId: string,
  cacheKey: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Resolve this line item's OWN Drive folder only. Pooling the order group's
  // folders made the card-picture refresh pull a sibling line item's newest
  // file onto this card (pouch art showing on the box/label cards).
  const loaded = await loadOrderFinalDriveContext(
    supabase,
    tenantId,
    orderId,
    { includeGroupSeeds: false }
  );

  if (loaded.kind === "not_found") {
    return { status: 404, body: { error: "Order not found" } };
  }
  if (loaded.kind === "not_configured") {
    return { status: 200, body: {
      hasFiles: false,
      hasDesignerFiles: false,
      fileCount: 0,
      hasPdf: false,
      hasFinalPdf: false,
      configured: false,
    } };
  }
  if (loaded.kind === "error") {
    return { status: 500, body: { error: loaded.message } };
  }

  const { order, settings, artworkUrl, seedIds, resolved, resolveError } = loaded;

  if (!resolved) {
    if (resolveError) {
      console.error("[gdrive-status]", resolveError);
    }
    return {
      status: 200,
      body: {
        hasFiles: false,
        hasDesignerFiles: false,
        fileCount: 0,
        hasPdf: false,
        hasFinalPdf: false,
        configured: true,
        folderId: seedIds[0] ?? null,
        ...(resolveError ? { error: resolveError } : {}),
      },
    };
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
        tenantId,
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

    const emptyResult = { hasFiles: false, fileCount: 0, hasPdf: false };
    const [designerResult, ...finalResults] = await Promise.all([
      designerCheckId
        ? folderHasFiles(settings, designerCheckId, {
            excludeChildIds: resolved.finalIds,
            skipFinalProdChildren: true,
          })
        : Promise.resolve(emptyResult),
      ...resolved.finalIds.map((folderId) =>
        folderHasFiles(settings, folderId, { directOnly: true })
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
                  tenant_id: tenantId,
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
    await swrSet(driveStatusKey(tenantId, orderId), responseData);
    return { status: 200, body: responseData };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gdrive-status]", message);
    return {
      status: 200,
      body: {
        hasFiles: false,
        hasDesignerFiles: false,
        fileCount: 0,
        hasPdf: false,
        hasFinalPdf: false,
        configured: true,
        folderId: seedIds[0] ?? null,
        error: message,
      },
    };
  }
}
