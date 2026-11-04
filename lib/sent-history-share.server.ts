import "server-only";

import { NextResponse } from "next/server";
import {
  createSentHistoryShareToken,
  SENT_HISTORY_SHARE_DAYS,
} from "@/lib/sent-history-share";

/** Server-only signing secret. Set SHARE_LINK_SECRET to rotate (revokes all links). */
export function sentHistoryShareSecret(): string {
  return (
    process.env.SHARE_LINK_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

/** `{ url, days }` for a read-only public Sent history page of this tenant. */
export function sentHistoryShareResponse(
  request: Request,
  tenantId: string
): NextResponse {
  const secret = sentHistoryShareSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Sharing is not configured" },
      { status: 503 }
    );
  }
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;
  const token = createSentHistoryShareToken(tenantId, secret);
  return NextResponse.json({
    url: `${base}/share/sent-history/${token}`,
    days: SENT_HISTORY_SHARE_DAYS,
  });
}
