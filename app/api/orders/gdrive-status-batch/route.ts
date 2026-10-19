import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { GET as getOneDriveStatus } from "../[id]/gdrive-status/route";

/**
 * POST { ids: string[] } — Drive status for many board cards in ONE request.
 *
 * The board used to fire one /gdrive-status request per card (~45 per load),
 * 5 at a time, so the last ones landed 10s+ after the board opened and every
 * click queued behind them. This runs the exact same per-order handler (same
 * caches, same result shape) for each id on the server, several at a time, and
 * returns { results: { [orderId]: status | null } }. null = that order failed;
 * the client falls back to the single-order endpoint for it.
 */
const MAX_IDS = 60;
const SERVER_CONCURRENCY = 8;

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim())
    ),
  ].slice(0, MAX_IDS);

  const results: Record<string, Record<string, unknown> | null> = {};
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const orderId = ids[next++];
      try {
        const res = await getOneDriveStatus(
          new Request(new URL(`/api/orders/${orderId}/gdrive-status`, request.url)),
          { params: Promise.resolve({ id: orderId }) }
        );
        results[orderId] = res.ok
          ? ((await res.json()) as Record<string, unknown>)
          : null;
      } catch {
        results[orderId] = null;
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SERVER_CONCURRENCY, ids.length) }, worker)
  );

  return NextResponse.json({ results });
}
