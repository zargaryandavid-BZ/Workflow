import { NextRequest, NextResponse } from "next/server";
import { generateApprovalLayerPreviewsForWaitingOrders } from "@/lib/approval-layer-previews";
import { deliverQueuedApprovalsWhenReady } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

/**
 * Cron entrypoint: pre-build the lightweight approval layer previews for every
 * order sitting in Waiting Approval (or with a pending/sent approval request)
 * that doesn't already have them. This is what makes the customer proof load
 * instantly — the heavy rasterization of the Final PDF happens here in the
 * background instead of inside the move click or, worse, when the customer
 * opens the link.
 *
 * Idempotent: `generateApprovalLayerPreviewsForWaitingOrders` skips orders whose
 * previews are already built and unchanged, and only rebuilds when the Final PDF
 * on Drive changes (e.g. a new version after a rejection). So once a proof is
 * built it stays built — no repeated work, no background noise.
 *
 * Auth: Authorization: Bearer $CRON_SECRET (or ?secret=). Schedule in vercel.json.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await generateApprovalLayerPreviewsForWaitingOrders();
    const built = results.filter((r) => !r.error && r.skus > 0).length;
    const failed = results.filter((r) => r.error);

    // Beta: now that proofs are (re)built, send any approval links that were
    // held back until their proof was ready (no-op unless a tenant is opted
    // into PROOF_GATE_SEND_TENANTS).
    let queuedSend = { delivered: 0, checked: 0 };
    try {
      queuedSend = await deliverQueuedApprovalsWhenReady();
    } catch (err) {
      console.error("[cron/approval-previews] queued send failed:", err);
    }

    return NextResponse.json({
      ok: true,
      orders_checked: results.length,
      orders_built: built,
      queued_sent: queuedSend.delivered,
      queued_checked: queuedSend.checked,
      failed: failed.map((r) => ({ orderId: r.orderId, title: r.title, error: r.error })),
      ran_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/approval-previews] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
