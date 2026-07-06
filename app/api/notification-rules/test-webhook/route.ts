import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { renderNotificationRuleTemplate } from "@/lib/notification-rules";

/** Dummy variables used when testing a webhook before real order data is available. */
const TEST_VARS = {
  order_id: "00000000-0000-0000-0000-000000000001",
  order_number: "ORD-TEST-001",
  customer_name: "Test Customer",
  customer_email: "test@example.com",
  customer_phone: "+1 818 555 1234",
  column_name: "Test Column",
  column_id: "00000000-0000-0000-0000-000000000002",
  tenant_id: "00000000-0000-0000-0000-000000000003",
  moved_at: new Date().toISOString(),
  due_date: "2026-12-31",
  product: "Test Product",
  die: "",
  assigned_to: "Staff Member",
};

export async function POST(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    webhook_url?: string;
    webhook_body_template?: string;
    webhook_headers?: Record<string, string>;
  };

  const url = body.webhook_url?.trim();
  if (!url) {
    return NextResponse.json({ error: "webhook_url is required" }, { status: 422 });
  }

  const renderedBody = renderNotificationRuleTemplate(
    body.webhook_body_template?.trim() || "{}",
    TEST_VARS
  );

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(body.webhook_headers ?? {}),
      },
      body: renderedBody,
    });

    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach endpoint";
    return NextResponse.json({ ok: false, status: 0, error: message });
  }
}
