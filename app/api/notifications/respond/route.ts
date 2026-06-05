import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { respondToNotification } from "@/lib/notifications";
import type { CustomerResponse } from "@/lib/types";

const RESPONSES: CustomerResponse[] = [
  "approved",
  "changes_requested",
  "info_submitted",
];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    response?: CustomerResponse;
    note?: string;
  };

  if (!body.token || !body.response || !RESPONSES.includes(body.response)) {
    return NextResponse.json(
      { error: "token and a valid response are required" },
      { status: 400 }
    );
  }

  // Anonymous customer: gate strictly on the unguessable token via the
  // service-role client.
  const admin = createAdminClient();
  const result = await respondToNotification(admin, {
    token: body.token,
    response: body.response,
    note: body.note ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, response: body.response });
}
