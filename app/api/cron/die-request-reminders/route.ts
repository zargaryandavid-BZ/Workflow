import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DIE_REMINDER, dieReminderDue } from "@/lib/die-request";
import { sendDieReminder } from "@/lib/die-request-send.server";

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
 * Cron: email + text manufacturers who haven't priced a die request yet.
 * First reminder after 2 days, then every 2 days, 3 at most (DIE_REMINDER).
 * Only "sent" requests (no quote). Weekdays, in vercel.json.
 * Auth: Authorization: Bearer $CRON_SECRET (or ?secret=).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("die_requests")
    .select("id, tenant_id, status, sent_at, reminder_count, last_reminder_at")
    .eq("status", "sent")
    .lt("reminder_count", DIE_REMINDER.max)
    .limit(500);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const due = ((data ?? []) as {
    id: string;
    tenant_id: string;
    status: "sent";
    sent_at: string;
    reminder_count: number;
    last_reminder_at: string | null;
  }[]).filter((row) => dieReminderDue(row, now));

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const row of due) {
    try {
      const result = await sendDieReminder(admin, { tenantId: row.tenant_id, requestId: row.id });
      results.push("error" in result ? { id: row.id, ok: false, error: result.error } : { id: row.id, ok: true });
    } catch (err) {
      console.error("[cron/die-request-reminders]", row.id, err);
      results.push({ id: row.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({
    ok: true,
    checked: data?.length ?? 0,
    reminded: results.filter((r) => r.ok).length,
    results,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
