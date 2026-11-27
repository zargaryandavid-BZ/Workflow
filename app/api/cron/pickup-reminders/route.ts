import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPickupReminders } from "@/lib/pickup-reminders.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

/**
 * Cron: pickup reminders (day 3/7/14), final notice (day 30), and
 * "OK to recycle" flag 30 days after the final notice. Daily, in vercel.json.
 * Sends nothing unless PICKUP_REMINDERS_LIVE=true — otherwise (or with
 * ?dry=1) it only reports what it would send.
 * Auth: Authorization: Bearer $CRON_SECRET (or ?secret=).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const live =
    process.env.PICKUP_REMINDERS_LIVE?.trim() === "true" &&
    req.nextUrl.searchParams.get("dry") !== "1";
  try {
    const { checked, results } = await runPickupReminders(createAdminClient(), { live });
    return NextResponse.json({ ok: true, live, checked, due: results.length, results });
  } catch (err) {
    console.error("[cron/pickup-reminders]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
